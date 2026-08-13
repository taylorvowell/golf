package expo.modules.frameclock

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlin.math.ceil

/**
 * The measuring instrument for platform-foundation step 02, probes 1 and 2.
 *
 * Step 01 confirmed iOS has `AVPlayerItemVideoOutput` + `CADisplayLink` and could NOT confirm an
 * Android equivalent; D19 later found one, and this class is the thing that turns that finding
 * from a documentation claim into a number. `expo-video` does not surface it, which is why this
 * module exists at all rather than being a wrapper.
 *
 * The measurement is a CLOSED LOOP, and that is the whole point:
 *
 *   1. ExoPlayer tells us, on the playback thread, that frame N is about to be rendered.
 *   2. We emit that to JS, which draws its overlay and calls [markOverlayCommitted] back.
 *   3. At the instant that call arrives we compare the frame JS just drew against the frame
 *      actually on the glass, and record the difference.
 *
 * Both ends of the comparison are timed natively, so the number is not a JS self-report and
 * cannot be flattered by a slow clock or a coalesced timer. Zero means the overlay is locked to
 * the presented frame; anything else is the honest cost of the JS round-trip, which is precisely
 * what decides whether the web player's overlay architecture survives the port or whether the
 * overlay has to be drawn natively.
 */
@UnstableApi
class FrameClockView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onFrameRendered by EventDispatcher<Map<String, Any>>()
  private val onReady by EventDispatcher<Map<String, Any>>()
  private val onPlayerError by EventDispatcher<Map<String, Any>>()

  private val main = Handler(Looper.getMainLooper())

  private var player: ExoPlayer? = null
  private var videoSurface: View? = null


  /**
   * Frames per second used for every index calculation.
   *
   * Supplied by JS rather than read from the container, matching how the web player gets it from
   * `analysis.json`. Stage 0 normalizes every analysed clip to CFR, so the analyzer's notion of
   * frame N and this view's notion must come from the same number or the overlay lands on the
   * wrong frame while every individual component looks correct.
   */
  var fps: Double = 60.0

  /** Emit an event for every presented frame. Off by default — 60 events/sec is a measurement
   *  mode, not a playback mode, and leaving it on would itself perturb what we are measuring. */
  var emitFrames: Boolean = false

  /**
   * Frames that have been handed to the surface but are scheduled to appear in the FUTURE.
   *
   * This exists because of a bias that made the first real measurement unusable.
   * `onVideoFrameAboutToBeRendered` fires *before* the frame is on the glass, and `releaseTimeNs`
   * is when it will be displayed — typically ~2 frames ahead at 60fps. Scoring the overlay
   * against the most recent callback therefore compares JS against a frame the screen has not
   * shown yet, and reports drift equal to the lead time even when the overlay is perfectly
   * synced. The first run on an S25+ read p95 = 2 frames against a measured lead of ~33ms, which
   * is the same 2 frames — the bias *was* the result.
   *
   * So the schedule is kept, and "what is actually on screen" is resolved against the wall clock
   * at the moment the question is asked. Written on the playback thread, read on the main thread.
   */
  private val scheduled = ArrayDeque<Pair<Int, Long>>()
  private val scheduleLock = Any()

  /**
   * Overlay commits for frames the decoder has not produced yet — frame index to commit time.
   *
   * A scrub commits its overlay for the target frame BEFORE asking for the seek, because it
   * already knows the target. Those commits are as early as an overlay can be, and they are
   * scored when the frame finally arrives rather than against whatever is on screen meanwhile.
   */
  private val pendingCommits = HashMap<Int, Long>()
  private val pendingLock = Any()

  /** The most recent callback, i.e. the newest frame the decoder has queued. Not on screen yet. */
  @Volatile private var queuedFrame: Int = -1

  /** Set when a seek is in flight, so the next presented frame can be scored against it. */
  @Volatile private var pendingSeekFrame: Int? = null

  private val overlayDrift = FrameStats()

  /**
   * How far AHEAD of a frame's scheduled display time JS learns about it, in ms.
   *
   * Positive is lead, and lead is good — it is the budget a JS-driven overlay has to draw in.
   * Previously this was computed as `now - releaseTimeNs`, which is lead with the sign inverted
   * and was reported as "delivery latency"; a p95 of -33ms is what exposed the deeper bias above.
   */
  private val leadTimeMs = FrameStats()
  private val seekError = FrameStats()

  /**
   * The frame actually on screen right now: the newest one whose scheduled display time has
   * already passed. Drops entries that are no longer the answer as it goes, so the deque stays
   * a couple of frames long.
   */
  private fun onScreenFrame(): Int {
    val now = System.nanoTime()
    synchronized(scheduleLock) {
      var current: Pair<Int, Long>? = null
      while (scheduled.isNotEmpty() && scheduled.first().second <= now) {
        current = scheduled.removeFirst()
      }
      // Put the answer back UNCHANGED so repeated calls between frames stay consistent. The pair
      // must keep the frame's own scheduled display time: re-inserting it stamped with the poll
      // time is a measurement bias — `markOverlayCommitted` looks this entry up and scores
      // lateness against its timestamp, so a poll (the sync panel reads stats every 250ms during
      // exactly the sessions being measured) would quietly shrink every late commit that follows
      // it. That is the v1/v2 family of instrument bias documented below, in a third form.
      if (current != null) scheduled.addFirst(current)
      return current?.first ?: -1
    }
  }

  /**
   * The HTTP data source the player reads through, so a request can carry the session.
   *
   * `MediaItem.fromUri` on the default factory has no way to set a header, and the media route is
   * behind auth: an unauthenticated request is answered as the development fallback identity and
   * returns **404, not 401**, so the video reads as a swing that does not exist (D48, D50). The
   * spike never hit this because it played a bundled asset and an unauthenticated fixture server.
   *
   * Cross-protocol redirects are allowed because the Supabase media driver answers `/video` with a
   * 307 to a signed https CDN URL while this app talks to the LAN server over http; refusing the
   * redirect would make the cloud driver fail in a way the local driver never shows.
   *
   * **Declared above `init`, and that placement is load-bearing.** Kotlin runs property
   * initializers and `init` blocks in source order, so a declaration below this block leaves the
   * field null while `buildPlayer()` reads it. Expo catches the resulting throw and substitutes an
   * `ErrorGroupView`, so the failure surfaces on the JS side as
   * `ErrorGroupView cannot be cast to FrameClockView` from whichever view function is called next
   * — naming a function that is fine, about a view that never got built.
   */
  private val httpFactory = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)

  init {
    // The player must exist before props arrive; source is applied when the prop lands.
    buildPlayer()
    setSurfaceType("surfaceView")
  }

  private fun buildPlayer() {
    val exo = ExoPlayer.Builder(context)
      .setMediaSourceFactory(
        DefaultMediaSourceFactory(DefaultDataSource.Factory(context, httpFactory))
      )
      .build()
    // DEFAULT is already EXACT in media3 1.9.0, but state it: a future default change would
    // silently turn frame-exact seeking into nearest-sync seeking, and the failure mode is a
    // player that looks fine and is up to a GOP out.
    exo.setSeekParameters(SeekParameters.EXACT)

    exo.setVideoFrameMetadataListener { presentationTimeUs, releaseTimeNs, _, _ ->
      // Playback thread. Keep this cheap — work done here delays the frame it describes.
      val frame = frameIndexOf(presentationTimeUs, fps)
      // TIME_UNSET means "render immediately", so its display time is now, not the future.
      val displayAtNs = if (releaseTimeNs == C.TIME_UNSET) System.nanoTime() else releaseTimeNs

      queuedFrame = frame
      // Score any overlay that was committed for this frame before it existed. Committed before
      // its display time is locked; the lead makes that the normal case for a draw-then-seek.
      val committedAt = synchronized(pendingLock) { pendingCommits.remove(frame) }
      if (committedAt != null) {
        val lateNs = committedAt - displayAtNs
        overlayDrift.add(
          if (lateNs <= 0L) 0.0 else ceil(lateNs / (1_000_000_000.0 / fps))
        )
      }
      synchronized(scheduleLock) {
        scheduled.addLast(frame to displayAtNs)
        // A seek or a stall can strand entries whose time never arrives relative to newer ones.
        while (scheduled.size > 16) scheduled.removeFirst()
      }

      val expected = pendingSeekFrame
      if (expected != null) {
        pendingSeekFrame = null
        // Scrub seeks are keyframe-fast and DELIBERATELY inexact — scoring them would let a drag
        // wreck the exactness figure for the one path that is still promised exact (D40).
        if (!scrubbing) seekError.add((frame - expected).toDouble())
      }

      if (emitFrames) {
        main.post {
          // Positive = JS heard about the frame this many ms before it is due on screen.
          leadTimeMs.add((displayAtNs - System.nanoTime()) / 1_000_000.0)
          onFrameRendered(
            mapOf(
              "frame" to frame,
              "presentationTimeUs" to presentationTimeUs,
              "releaseTimeNs" to displayAtNs
            )
          )
        }
      }
    }

    exo.addListener(object : Player.Listener {
      override fun onPlaybackStateChanged(state: Int) {
        if (state == Player.STATE_READY) {
          val format = exo.videoFormat
          onReady(
            mapOf(
              "durationMs" to (if (exo.duration == C.TIME_UNSET) 0L else exo.duration),
              "width" to (format?.width ?: 0),
              "height" to (format?.height ?: 0),
              // The container's own frame rate, reported alongside the fps prop precisely so a
              // mismatch is visible rather than silently absorbed into wrong frame indices.
              "containerFps" to (format?.frameRate?.toDouble() ?: 0.0)
            )
          )
        }
      }

      override fun onPlayerError(error: PlaybackException) {
        onPlayerError(mapOf("message" to (error.message ?: error.errorCodeName)))
      }
    })

    player = exo
  }

  /**
   * `surfaceView` is faster and lower-power; `textureView` composites conventionally and is the
   * documented fix for the overlapping-views z-order bug. Step 02 asks which one an
   * overlay-on-video layout actually needs, so it is switchable and measured, not assumed.
   */
  fun setSurfaceType(type: String) {
    val exo = player ?: return
    videoSurface?.let { removeView(it) }

    val surface: View = if (type == "textureView") {
      TextureView(context).also { exo.setVideoTextureView(it) }
    } else {
      SurfaceView(context).also { exo.setVideoSurfaceView(it) }
    }
    surface.layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    addView(surface, 0)
    videoSurface = surface
  }

  private var sourceUri: String? = null
  private var sourceHeaders: Map<String, String> = emptyMap()

  /** What is currently prepared, so re-applying identical props does not restart playback. */
  private var appliedSource: Pair<String, Map<String, String>>? = null

  fun setSource(uri: String?) {
    sourceUri = uri
  }

  /** The headers every media request carries — in practice `Authorization` and the client version. */
  fun setHeaders(headers: Map<String, String>) {
    sourceHeaders = headers
  }

  /**
   * Prepare the player, once, after every prop in the batch has been applied.
   *
   * **The setters above deliberately only record.** Props arrive in whatever order the view
   * receives them, so preparing inside `setSource` fetches with whatever headers happen to have
   * landed — and on the pass where `source` comes first that is none. The request then goes out
   * unauthenticated, is answered as the development fallback identity, and comes back **404 rather
   * than 401** (D48), which reads as a swing that does not exist. It would also self-heal on the
   * next apply, making it the worst kind of bug: intermittent, and invisible when it heals.
   *
   * `OnViewDidUpdateProps` fires after the whole batch, which removes the ordering question rather
   * than betting on it.
   */
  fun applySource() {
    val exo = player ?: return
    val uri = sourceUri
    if (uri.isNullOrBlank()) {
      appliedSource = null
      exo.clearMediaItems()
      return
    }

    val next = uri to sourceHeaders
    val current = appliedSource
    if (current == next) return
    appliedSource = next

    // Set on the factory rather than per-item: `DefaultHttpDataSource` reads its default request
    // properties when each data source is created, and the player creates one per load — including
    // the ones a seek triggers, which is most of them in this app.
    httpFactory.setDefaultRequestProperties(sourceHeaders)

    // Headers-only change on the same uri: the factory update above is the whole job. JS refreshes
    // the headers prop on every token rotation, and every data source a FUTURE seek creates reads
    // the factory — re-preparing here would restart playback mid-watch to swap a credential the
    // picture never sees.
    if (current != null && current.first == uri) return

    exo.setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
    exo.prepare()
  }

  fun play() {
    player?.play()
  }

  fun pause() {
    player?.pause()
  }

  /**
   * Seek to the middle of [frame]'s display interval and score what actually arrives.
   *
   * The result is not returned here — it is recorded when the next frame is presented, because
   * the only trustworthy answer to "did the seek land on the right frame" is the timestamp of the
   * frame that subsequently reached the screen. Asking the player where it thinks it is would
   * measure the player's bookkeeping, not the picture.
   */
  /** "start" by default — media3 resolves seeks forward, so the midpoint rule lands late (D40). */
  var seekMode: String = "start"

  /**
   * Fast-scrub mode: media3's own scrubbing mode while a finger is down.
   *
   * The clips' GOP is short (a keyframe every 10 frames — measured, not assumed), so per-seek
   * DECODE was never the cost; the cost is ExoPlayer's ordinary seek pipeline — renderer flush
   * and codec round-trip on every touch sample — which is why the overlay (drawing the target it
   * already knows, D36) tracked a finger while the picture trailed it. `setScrubbingModeEnabled`
   * exists for exactly this (media3 1.7+): it suppresses the per-seek teardown, drops audio, and
   * preempts superseded seeks, keeping seeks FRAME-EXACT while landing fast. Seek parameters stay
   * EXACT — this is not the keyframe-compromise design; it was tried first and its granularity
   * read as "not live". CLOSEST_SYNC remains the fallback lever if a device proves too slow even
   * in scrubbing mode.
   */
  @Volatile private var scrubbing = false

  fun setScrubbing(active: Boolean) {
    val exo = player ?: return
    scrubbing = active
    exo.setScrubbingModeEnabled(active)
  }

  fun seekToFrame(frame: Int) {
    val exo = player ?: return
    pendingSeekFrame = frame
    exo.seekTo(seekTargetMs(frame, fps, seekMode))
  }

  /**
   * JS calls this immediately after committing an overlay for [frame].
   *
   * Drift is measured against the frame on the glass at the moment the call arrives, so it counts
   * whole frames of lateness in the JS round-trip. A negative value would mean JS drew ahead of
   * the decoder, which only happens if [fps] disagrees with the media.
   */
  /**
   * Did the overlay for frame N land before N reached the glass?
   *
   * ## Two bugs, in opposite directions, and this is the third attempt
   *
   * v1 compared JS against the newest QUEUED frame. That inflated drift by the callback's lead
   * time and read p95 = 2 frames when the lead was ~2 frames — the bias *was* the result.
   *
   * v2 (the version this replaces) compared against what was ON SCREEN at the instant JS acked.
   * That is the mirror image of the same mistake: `onFrameRendered` fires ~49ms — about three
   * frames at 60fps — BEFORE the frame it names is displayed, so an overlay drawn immediately and
   * perfectly early scored −3. Measured on an S25+: sync-ack p50 −3 against a lead p95 of 49.1ms.
   * The ceiling probe removed React entirely and got *worse* (−3 vs −2), which is the signature of
   * a measurement bias rather than a rendering cost — the React commit had been partially
   * cancelling the lead.
   *
   * Neither version answered the actual question, which is not "how far apart are these two
   * numbers right now" but **"was the overlay ready in time?"** So: look up the frame's own
   * scheduled display time and compare against the clock. Early is 0 — early is the whole point of
   * having a lead — and late is counted in frames.
   */
  fun markOverlayCommitted(frame: Int) {
    // Mid-drag the overlay deliberately draws the PRESENTED frame — commits would score the
    // instrument against its own output and pollute the drift record scrubbing is excluded from.
    if (scrubbing) return
    val now = System.nanoTime()
    val displayAtNs = synchronized(scheduleLock) {
      scheduled.firstOrNull { it.first == frame }?.second
    }

    if (displayAtNs == null) {
      val current = onScreenFrame()
      if (current >= 0 && current > frame) {
        // Already displayed and drained: JS is genuinely late, and the gap is the honest cost.
        overlayDrift.add((current - frame).toDouble())
        return
      }
      /**
       * The frame has not been scheduled yet — the overlay was committed for a frame the decoder
       * has not produced. That is the EARLIEST possible commit, not a late one, and scoring it
       * against whatever happens to be on screen is how the draw-then-seek scrub probe first
       * measured p50 13 while doing the ideal thing.
       *
       * So it is parked, and scored when the frame actually arrives (see the metadata listener).
       * This is the pattern a scrub must use — the app knows its target before the decoder does —
       * so the instrument has to be able to express it.
       */
      synchronized(pendingLock) {
        pendingCommits[frame] = now
        if (pendingCommits.size > 64) {
          val stale = now - 2_000_000_000L
          pendingCommits.entries.removeAll { it.value < stale }
        }
      }
      return
    }

    val lateNs = now - displayAtNs
    if (lateNs <= 0L) {
      overlayDrift.add(0.0) // committed before the frame was due — locked
      return
    }
    val frameNs = 1_000_000_000.0 / fps
    overlayDrift.add(ceil(lateNs / frameNs))
  }

  /**
   * Playback rate. 0.25 plays a 240fps clip at true 60fps on screen — four times as many frames
   * across the same motion, which is the entire point of capturing at 240.
   *
   * ExoPlayer resamples timestamps rather than dropping frames, so every captured frame is still
   * presented and `onFrameRendered` still reports the real frame index. Slowing playback therefore
   * does NOT change what the overlay is measured against.
   */
  fun setPlaybackSpeed(speed: Float) {
    player?.setPlaybackSpeed(speed)
  }

  /** Audio only — the scrub chase plays the video at whatever rate follows the finger, and the
   *  soundtrack at 4x is noise, not information. Video timing is unaffected by volume. */
  fun setMuted(muted: Boolean) {
    player?.volume = if (muted) 0f else 1f
  }

  fun resetStats() {
    synchronized(pendingLock) { pendingCommits.clear() }
    overlayDrift.reset()
    leadTimeMs.reset()
    seekError.reset()
    synchronized(scheduleLock) { scheduled.clear() }
  }

  fun stats(): Map<String, Any> = mapOf(
    "overlayDriftFrames" to overlayDrift.toMap(),
    "leadTimeMs" to leadTimeMs.toMap(),
    "seekErrorFrames" to seekError.toMap(),
    "onScreenFrame" to onScreenFrame(),
    "queuedFrame" to queuedFrame,
    // The player's OWN bookkeeping, which is a third answer to "where are we" and deliberately
    // reported next to the other two. The sync panel exists because those three numbers can
    // disagree, and a disagreement is the bug — a position that advances while the picture does
    // not is a stall, and a position that matches nothing is wrong fps.
    "positionMs" to (player?.currentPosition ?: 0L),
    "playing" to (player?.isPlaying ?: false),
    "fps" to fps
  )

  fun release() {
    // Stop the listener queueing first, then drop what it already queued: with emitFrames on, the
    // playback thread posts a lambda per presented frame to `main`, and posts still queued when
    // the view is destroyed would run afterwards — dispatching an event against a dead view.
    emitFrames = false
    main.removeCallbacksAndMessages(null)
    player?.release()
    player = null
  }
}
