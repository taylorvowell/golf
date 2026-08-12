<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>SwingSage Swing Viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #050706;
      overscroll-behavior: none;
    }

    body {
      min-height: 100dvh;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }

    #swingSagePressed {
      --sage: #b8ff4a;
    }

    #swingSagePressed .glass {
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }

    #swingSagePressed .soft {
      background: rgba(13, 18, 14, .72);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }

    #swingSagePressed .video {
      background:
        radial-gradient(circle at 58% 28%, #6e8068 0%, #4d5d49 22%, #2c382d 46%, #141a15 70%, #050706 100%);
    }

    #swingSagePressed .scrub-track {
      background:
        linear-gradient(90deg, var(--sage) 0 42%, rgba(255,255,255,.18) 42% 100%);
    }

    #swingSagePressed .film-wheel {
      perspective: 420px;
      mask-image: linear-gradient(
        90deg,
        transparent 0%,
        rgba(0,0,0,.42) 10%,
        #000 27%,
        #000 70%,
        rgba(0,0,0,.4) 89%,
        transparent 100%
      );
      -webkit-mask-image: linear-gradient(
        90deg,
        transparent 0%,
        rgba(0,0,0,.42) 10%,
        #000 27%,
        #000 70%,
        rgba(0,0,0,.4) 89%,
        transparent 100%
      );
    }

    #swingSagePressed .frame-cell:nth-child(1) {
      opacity: .25;
      transform: scale(.82) rotateY(13deg);
    }

    #swingSagePressed .frame-cell:nth-child(2) {
      opacity: .5;
      transform: scale(.9) rotateY(8deg);
    }

    #swingSagePressed .frame-cell:nth-child(3) {
      opacity: .78;
      transform: scale(.96) rotateY(3deg);
    }

    #swingSagePressed .frame-cell:nth-child(4) {
      opacity: 1;
      transform: scale(1);
    }

    #swingSagePressed .frame-cell:nth-child(5) {
      opacity: .82;
      transform: scale(.96) rotateY(-3deg);
    }

    #swingSagePressed .frame-cell:nth-child(6) {
      opacity: .55;
      transform: scale(.9) rotateY(-8deg);
    }

    #swingSagePressed .frame-cell:nth-child(7) {
      opacity: .28;
      transform: scale(.82) rotateY(-13deg);
    }

    #swingSagePressed .pressed-play {
      background: linear-gradient(145deg, #9fe135, #c5ff58);
      box-shadow:
        inset 0 5px 10px rgba(0,0,0,.28),
        inset 0 -2px 4px rgba(255,255,255,.24),
        0 1px 0 rgba(255,255,255,.08);
    }

    #swingSagePressed .pressed-play::after {
      content: "";
      position: absolute;
      inset: 5px;
      border-radius: 9999px;
      border: 1px solid rgba(0,0,0,.16);
    }

    #swingSagePressed .speed-option.active {
      background: rgba(184,255,74,.14);
      color: var(--sage);
    }

    #swingSagePressed .safe-bottom {
      padding-bottom: max(8px, env(safe-area-inset-bottom));
    }

  </style>
</head>

<body class="text-white antialiased">
  <main class="min-h-[100dvh] bg-[#050706]">
    <div class="flex w-full justify-center py-2">
      <div
        id="swingSagePressed"
        class="relative aspect-[9/16] w-full max-w-[410px] overflow-hidden rounded-[30px] border border-white/10 bg-[#050706] text-white"
      >
        <!-- VIDEO PLACEHOLDER -->
        <div class="video absolute inset-0">
          <div class="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/75"></div>

          <!-- simple golfer placeholder -->
          <div class="absolute left-[46%] top-[22%] h-[31px] w-[31px] rounded-full border-[6px] border-white/70"></div>
          <div class="absolute left-[47%] top-[28%] h-[103px] w-[8px] rotate-[4deg] rounded-full bg-white/70"></div>
          <div class="absolute left-[45%] top-[34%] h-[82px] w-[8px] origin-top rotate-[48deg] rounded-full bg-white/70"></div>
          <div class="absolute left-[49%] top-[47%] h-[108px] w-[8px] origin-top rotate-[15deg] rounded-full bg-white/70"></div>
          <div class="absolute left-[45%] top-[47%] h-[108px] w-[8px] origin-top -rotate-[11deg] rounded-full bg-white/70"></div>
          <div class="absolute left-[23%] top-[30%] h-[3px] w-[135px] origin-right -rotate-[22deg] rounded-full bg-[var(--sage)] opacity-90"></div>
        </div>

        <!-- TOP HEADER -->
        <header class="absolute inset-x-3 top-3 z-20 h-[58px]">
          <button
            type="button"
            aria-label="Back"
            class="soft absolute left-0 top-0 grid h-12 w-12 place-items-center rounded-[18px] border border-white/15"
          >
            <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>


          <div class="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap text-center">
            <div class="text-[13px] font-medium tracking-[-.02em] text-white">Swing #42 · Aug 12</div>
          </div>

<div class="mt-1 text-base font-medium tracking-[-.02em]">
              <span>7 Iron</span>
              <span class="mx-1 text-white/30">·</span>
              <span class="text-white/50">Aug 12</span>
            </div>
          </div>

          <div class="absolute right-0 top-0 flex gap-1.5">
            <button
              type="button"
              class="soft flex h-12 min-w-[48px] flex-col items-center justify-center rounded-[17px] border border-white/10 px-2"
            >
              <div class="flex items-center gap-1 text-sm font-medium">
                <svg
                  viewBox="0 0 24 24"
                  class="h-3.5 w-3.5 text-[var(--sage)]"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <path
                    d="M8 17l-4 3 1.2-4.4A7 7 0 1 1 19 12a6.9 6.9 0 0 1-1 3.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                4
              </div>
              <div class="mt-0.5 text-[7px] uppercase tracking-[.16em] text-white/42">Coach</div>
            </button>

            <button
              type="button"
              class="soft flex h-12 min-w-[48px] flex-col items-center justify-center rounded-[17px] border border-white/10 px-2"
            >
              <div class="text-base font-medium leading-none">82</div>
              <div class="mt-1 text-[7px] uppercase tracking-[.16em] text-white/42">Score</div>
            </button>
          </div>
        </header>



        <!-- FLOATING OVERLAYS BUTTON -->
        <button
          type="button"
          aria-label="Overlays"
          class="soft absolute right-4 top-[88px] z-20 grid h-11 w-11 place-items-center rounded-[16px] border border-white/12 text-white/85"
        >
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M12 4 4 8.5 12 13l8-4.5L12 4Z" stroke-linejoin="round"/>
            <path d="m4 12 8 4.5 8-4.5" stroke-linejoin="round"/>
          </svg>
        </button>



        <!-- BOTTOM ANALYSIS CONTROLS -->
        <section class="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-[#050706] via-[#050706]/95 to-transparent pt-16">
          <div class="px-5">
            <!-- TIME + COMPARE -->

            <div class="mb-2 flex items-center justify-end">
              <button
                type="button"
                class="flex h-8 items-center gap-1.5 rounded-xl border border-white/[.09] bg-white/[.045] px-3 text-[9px] font-semibold uppercase tracking-[.12em] text-white/65"
              >
                <svg
                  viewBox="0 0 24 24"
                  class="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                >
                  <rect x="3" y="5" width="7" height="14" rx="1.5"/>
                  <rect x="14" y="5" width="7" height="14" rx="1.5"/>
                </svg>
                Compare
              </button>
            </div>

            <!-- FILMSTRIP + CONNECTED PLAYHEAD -->

            <div class="relative pb-[26px]">
              <div class="relative rounded-2xl border border-white/[.08] bg-white/[.035] p-1.5">
                <div class="film-wheel grid h-12 grid-cols-7 gap-1 overflow-hidden rounded-xl">
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#18251a,#384a35)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#1a281c,#52624b)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#263728,#687a60)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#344a36,#7c8d71)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#2a3c2c,#607154)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#1d2d20,#455640)]"></div>
                  <div class="frame-cell rounded-lg bg-[linear-gradient(135deg,#142017,#334131)]"></div>
                </div>
              </div>

              <!-- connected vertical playhead -->
              <div
                class="pointer-events-none absolute left-[42%] top-[-4px] bottom-[13px] z-10 w-[2px] -translate-x-1/2 bg-[var(--sage)] shadow-[0_0_12px_rgba(184,255,74,.55)]"
              >
                <div
                  class="absolute left-1/2 top-0 -translate-x-1/2 rounded-md bg-[var(--sage)] px-1.5 py-[2px] text-[8px] font-black text-black"
                >
                  184
                </div>
              </div>

              <!-- SCRUB TRACK -->
              <div class="absolute inset-x-0 bottom-0 flex items-center gap-3">
                <span class="text-[10px] tabular-nums text-white/35">0:00</span>

                <div class="relative h-7 flex-1">
                  <div class="scrub-track absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"></div>
                  <div
                    class="absolute left-[42%] top-1/2 z-20 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-[var(--sage)] bg-[#0b0e0c]"
                  ></div>
                </div>

                <span class="text-[10px] tabular-nums text-white/35">0:03</span>
              </div>
            </div>
          </div>

          <!-- BOTTOM DOCK -->
          <div class="safe-bottom mt-3 px-4">
            <nav
              class="glass relative mx-auto h-[70px] rounded-[28px] border border-white/[.10] bg-[#111612]/85 px-3"
            >
              <!-- SPEED TOGGLE -->
              <div
                class="absolute left-3 top-1/2 flex h-11 w-[118px] -translate-y-1/2 items-center rounded-[16px] bg-black/25 p-1"
              >
                <button
                  type="button"
                  class="speed-option active h-full flex-1 rounded-[12px] text-[10px] font-semibold"
                >
                  .25×
                </button>

                <button
                  type="button"
                  class="speed-option h-full flex-1 rounded-[12px] text-[10px] font-semibold text-white/45"
                >
                  .5×
                </button>

                <button
                  type="button"
                  class="speed-option h-full flex-1 rounded-[12px] text-[10px] font-semibold text-white/45"
                >
                  1×
                </button>
              </div>

              <!-- CENTER PLAY -->
              <button
                type="button"
                aria-label="Play"
                class="pressed-play absolute left-1/2 top-1/2 grid h-[54px] w-[54px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-black"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"></path>
                </svg>
              </button>

              <!-- RIGHT ACTIONS -->
              <div class="absolute right-3 top-1/2 flex h-11 -translate-y-1/2 items-center gap-1">
                <button
                  type="button"
                  class="flex h-11 w-[52px] flex-col items-center justify-center rounded-[15px] text-white/55"
                >
                  <svg
                    viewBox="0 0 24 24"
                    class="h-[17px] w-[17px]"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                  >
                    <path d="M5 19V11M12 19V5M19 19v-8" stroke-linecap="round"/>
                  </svg>
                  <span class="mt-1 text-[7px] font-semibold uppercase tracking-[.11em]">Metrics</span>
                </button>

                <button
                  type="button"
                  class="flex h-11 w-[52px] flex-col items-center justify-center rounded-[15px] text-[var(--sage)]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    class="h-[17px] w-[17px]"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                  >
                    <path
                      d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="mt-1 text-[7px] font-semibold uppercase tracking-[.11em]">Analyze</span>
                </button>
              </div>
            </nav>
          </div>
        </section>
      </div>
    </div>

  </main>

  <script>
    const speedButtons = [...document.querySelectorAll('#swingSagePressed .speed-option')];

    speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedButtons.forEach((button) => {
          button.classList.remove('active');
          button.classList.add('text-white/45');
        });

        btn.classList.add('active');
        btn.classList.remove('text-white/45');
      });
    });
  </script>
</body>
</html>
