import { useMemo, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, UploadCloud } from "lucide-react";
import type { HistoricalFmeaCase } from "../../data/fmeaMockData";
import { StatusBadge } from "../fmea/FmeaSuggestionTable";

type ImageUploadSimulationProps = {
  historicalCases: HistoricalFmeaCase[];
};

type Detection = {
  label: string;
  detail: string;
  risks: string[];
  families: string[];
};

const detections: Detection[] = [
  {
    label: "Thin frame / glasses",
    detail: "Narrow bridge, temple hinge, and lens rim geometry",
    risks: ["Fail abuse", "Broken part (Function)"],
    families: ["Sunglass"],
  },
  {
    label: "Strap or handle",
    detail: "Loop root, pull point, and molded carry feature",
    risks: ["Tear Part", "Weldline", "Fail abuse"],
    families: ["Bag", "Dog Bag"],
  },
  {
    label: "Pin-boss / assembly joint",
    detail: "Press boss, snap datum, and lead-in area",
    risks: ["Gap Part", "Improper Assembly"],
    families: ["Dog Body", "Bag Cover"],
  },
  {
    label: "Tail-body clearance",
    detail: "Rotating peg, socket depth, and stop face",
    risks: ["Gap Part", "Mix-up assembly", "Improper function"],
    families: ["Dog Tail", "Dog Head"],
  },
  {
    label: "Decoration/tampo area",
    detail: "Paint mask edge, rub zone, and tampo contact surface",
    risks: ["Under Spray", "Over Spray", "Abrasion Fail / Adhesion Fail"],
    families: ["Holder", "Shoes", "Sunglass"],
  },
];

export function ImageUploadSimulation({ historicalCases }: ImageUploadSimulationProps) {
  const [active, setActive] = useState(false);
  const [fileName, setFileName] = useState("sample-tooling-review.png");

  const similarCasesByDetection = useMemo(
    () =>
      detections.map((detection) => ({
        ...detection,
        cases: historicalCases
          .filter(
            (item) => detection.risks.includes(item.failure) && detection.families.includes(item.normalizedFamily),
          )
          .slice(0, 3),
      })),
    [historicalCases],
  );

  function handleFile(file?: File) {
    if (file) {
      setFileName(file.name);
    }
    setActive(true);
  }

  return (
    <div className="space-y-5">
      <section
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          handleFile(event.dataTransfer.files[0]);
        }}
        className="rounded-md border-2 border-dashed border-steel-300 bg-white p-6 text-center shadow-panel"
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-steel-100 text-steel-700">
          <UploadCloud size={26} />
        </div>
        <h2 className="mt-3 text-lg font-bold text-steel-950">Image Upload Simulation</h2>
        <p className="mt-1 text-sm text-steel-500">Drop a tooling image or use the sample to trigger mock detections.</p>
        <div className="mt-4 flex flex-col justify-center gap-3 sm:flex-row">
          <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-steel-300 px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-steel-100">
            <ImagePlus size={18} />
            Upload image
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => handleFile(event.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            onClick={() => handleFile()}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-steel-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-steel-700"
          >
            <Camera size={18} />
            Use sample image
          </button>
        </div>
      </section>

      {active ? (
        <>
          <section className="rounded-md border border-steel-200 bg-white p-4 shadow-panel">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium text-steel-500">Loaded image</p>
                <h3 className="text-lg font-bold text-steel-950">{fileName}</h3>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-sm font-semibold text-emerald-800">
                <CheckCircle2 size={16} />
                Simulated detections ready
              </span>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {similarCasesByDetection.map((detection) => (
              <article key={detection.label} className="rounded-md border border-steel-200 bg-white p-4 shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-steel-950">{detection.label}</h3>
                    <p className="mt-1 text-sm text-steel-500">{detection.detail}</p>
                  </div>
                  <div className="rounded-md bg-steel-100 p-2 text-steel-700">
                    <ImagePlus size={18} />
                  </div>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">Mapped risks</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detection.risks.map((risk) => (
                      <span key={risk} className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                        {risk}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">
                    Similar historical cases
                  </div>
                  {detection.cases.map((item) => (
                    <div key={item.id} className="rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-steel-950">
                            {item.sourceTag} p{item.sourcePage} - {item.toolDescription}
                          </div>
                          <div className="mt-1 text-steel-600">{item.failure}</div>
                        </div>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="mt-2 text-steel-600">{item.recommendation}</div>
                    </div>
                  ))}
                  {detection.cases.length === 0 ? (
                    <div className="rounded-md bg-steel-50 p-3 text-sm text-steel-500">
                      No close case in the current mock data.
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
