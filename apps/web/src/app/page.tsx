import Link from "next/link";
import { listSwings, MEDIA_ROOT } from "@/lib/swings";
import { Chip, MicroHead, NotBuilt } from "@/components/ui/kiosk";

export const dynamic = "force-dynamic"; // the analyzer writes new swings while dev runs

/**
 * The swing log.
 *
 * Same design system as the player: `workspace-bar` header, `kiosk-panel` cards. It carries
 * no scores because nothing scores a swing yet — each card shows what was actually measured
 * (frames, view, pose coverage, tempo, whether the club trace passed its gate) plus the
 * contact frame the analyzer already writes.
 */
export default async function Home() {
  const swings = await listSwings();

  return (
    <main className="relative mx-auto max-w-[1800px] space-y-5 px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-7">
      <div className="workspace-bar">
        <div className="workspace-primary">
          <div className="brand-lockup" aria-label="SwingSage">
            <span className="brand-mark">SS</span>
            <div>
              <p className="text-lg font-bold tracking-[-.03em]">SwingSage</p>
              <p className="text-[9px] font-semibold uppercase tracking-[.2em] text-neutral-600">
                AI Swing Coach
              </p>
            </div>
          </div>
          <nav className="folder-tabs" aria-label="Views">
            <span className="folder-tab active flex items-center gap-3 px-7 py-3 text-left">
              <span className="folder-icon grid h-10 w-10 place-items-center rounded-xl bg-white/[.04]
                               text-lg text-neutral-500">▤</span>
              <span className="block text-base font-bold tracking-[-.02em]">Swing Log</span>
            </span>
          </nav>
        </div>
        <div className="workspace-actions">
          <span className="workspace-action border border-line bg-raised text-neutral-500">
            {swings.length} analysed {swings.length === 1 ? "swing" : "swings"}
          </span>
        </div>
      </div>

      {swings.length === 0 ? (
        <section className="kiosk-panel rounded-[32px] p-6 sm:p-8">
          <MicroHead tone="acid">Empty log</MicroHead>
          <h1 className="gradient-text mt-2 text-4xl font-semibold tracking-[-.04em]">
            No analysed swings yet.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
            There is no upload flow yet — a swing is analysed by running the pipeline by hand and
            appears here when it finishes.
          </p>
          <pre className="scrollbar mt-4 overflow-x-auto rounded-2xl border border-line bg-black/40 p-4
                          text-[12px] leading-6 text-neutral-400">
{`cd services/analyzer
.venv\\Scripts\\python.exe scripts\\burnin.py <video> --view dtl --handedness right`}
          </pre>
          <p className="mt-3 text-[11px] text-neutral-600">Looking in {MEDIA_ROOT}</p>
          <div className="mt-4"><NotBuilt what="upload + job queue" /></div>
        </section>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {swings.map((s) => {
            const cov = s.poseCoverage * 100;
            return (
              <li key={s.id}>
                {/* The hover shadow is spelled out rather than using the `shadow-acid` theme
                    token: Tailwind v4 resolves `shadow-<name>` against the colour namespace
                    first, and `--color-acid` exists, so the token silently becomes a shadow
                    colour with no shadow to colour. The sample writes its shadows out too. */}
                <Link href={`/swing/${s.id}`}
                  className="kiosk-panel group block overflow-hidden rounded-[28px] transition
                             hover:border-acid/30
                             hover:shadow-[0_0_0_1px_rgba(94,208,255,.18),0_18px_60px_rgba(94,208,255,.18)]">
                  <div className="video-surface relative aspect-video overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/swings/${s.id}/thumb`} alt=""
                         className="h-full w-full object-cover opacity-85 transition
                                    group-hover:scale-[1.03] group-hover:opacity-100" />
                    <span className="absolute left-3 top-3 rounded-xl border border-white/10 bg-black/55
                                     px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[.18em] backdrop-blur">
                      {s.view.toUpperCase()}
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="truncate text-base font-semibold tracking-[-.02em]">{s.id}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="qbar">
                        <i style={{
                          width: `${cov}%`,
                          background: cov > 90 ? "#22C55E" : cov > 50 ? "#FACC15" : "#E5484D",
                        }} />
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                        pose {cov.toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Chip>{s.frameCount}f · {s.fps.toFixed(0)}fps</Chip>
                      {s.tempoRatio !== null && (
                        <Chip tone={s.tempoRatio < 2.5 || s.tempoRatio > 3.5 ? "warn" : "acid"}>
                          tempo {s.tempoRatio}:1
                        </Chip>
                      )}
                      {s.traceEnabled && <Chip tone="violet">trace</Chip>}
                    </div>
                    <p className="mt-3 truncate text-[10px] text-neutral-600">{s.model}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
