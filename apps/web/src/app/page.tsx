import Link from "next/link";
import { listSwings, MEDIA_ROOT } from "@/lib/swings";

export const dynamic = "force-dynamic"; // the analyzer writes new swings while dev runs

export default async function Home() {
  const swings = await listSwings();

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">SwingSage</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Swing log — {swings.length} analysed {swings.length === 1 ? "swing" : "swings"}
        </p>
      </header>

      {swings.length === 0 ? (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-400">
          <p className="mb-2">No analysed swings found.</p>
          <p className="text-neutral-500">
            Run the analyzer, then reload:
            <code className="block mt-2 p-2 rounded bg-neutral-950 text-neutral-300 text-xs">
              cd services/analyzer{"\n"}
              .venv\Scripts\python.exe scripts\burnin.py &lt;video&gt;
            </code>
            <span className="block mt-2 text-xs">Looking in {MEDIA_ROOT}</span>
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {swings.map((s) => (
            <li key={s.id}>
              <Link href={`/swing/${s.id}`}
                    className="block rounded-xl border border-neutral-800 bg-neutral-900/60 p-4
                               hover:border-neutral-600 transition">
                <div className="font-medium truncate">{s.id}</div>
                <div className="mt-2 text-xs text-neutral-400 space-y-0.5">
                  <div>{s.frameCount} frames @ {s.fps.toFixed(2)}fps · {s.view.toUpperCase()}</div>
                  <div>
                    pose{" "}
                    <b className={s.poseCoverage > 0.9 ? "text-green-400" : "text-amber-400"}>
                      {(s.poseCoverage * 100).toFixed(0)}%
                    </b>
                    {s.tempoRatio !== null && <> · tempo <b className="text-neutral-200">{s.tempoRatio}:1</b></>}
                    {s.traceEnabled && <> · <span className="text-blue-400">trace</span></>}
                  </div>
                  <div className="text-neutral-600 truncate">{s.model}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
