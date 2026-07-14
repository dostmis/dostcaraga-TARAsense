import Link from "next/link";
import { RepostStudyControl } from "@/components/dashboards/repost-study-control";
import { StudyDeleteControl } from "@/components/dashboards/study-delete-control";

export interface StudyPipelineItem {
  id: string;
  title: string;
  productName: string;
  category: string;
  stage: string;
  status: string;
  sampleSize: number;
  scheduleEndsAt: Date | null;
  /** Optional attribution line, e.g. "On behalf of Nanay's Kakanin". */
  attribution?: string | null;
  _count: {
    responses: number;
    participants: number;
  };
}

/**
 * Grouped study pipeline (Scheduled / In Progress / Completed) with Form+QR,
 * Result, Repost and Delete controls. Shared by the MSME dashboard and the FIC
 * "My Studies" view so both roles manage their studies identically.
 */
export function StudyPipelineList({
  studies,
  redirectTo,
}: {
  studies: StudyPipelineItem[];
  redirectTo: string;
}) {
  const groups = groupStudyPipeline(studies);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-[#eadfd6] pb-2">
            <div>
              <h2 className="text-lg font-semibold text-[#2e231c]">{group.title}</h2>
              <p className="text-sm text-[#6f5b4f]">{group.description}</p>
            </div>
            <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-xs font-medium text-[#695446]">
              {group.studies.length} {group.studies.length === 1 ? "study" : "studies"}
            </span>
          </div>

          {group.studies.length === 0 && (
            <article className="rounded-2xl border border-dashed border-[#e4d7cc] bg-white p-5 text-sm text-[#6f5b4f]">
              No {group.title.toLowerCase()} studies.
            </article>
          )}

          {group.studies.map((study) => {
            const targetReached = study._count.responses >= study.sampleSize;
            const hasAnyParticipants = study._count.participants > 0;
            const isExpired =
              study.scheduleEndsAt != null && new Date(study.scheduleEndsAt).getTime() <= Date.now();
            const isClosedBelowTarget = (study.status === "ANALYZING" || isExpired) && !targetReached;
            return (
              <article key={study.id} className="rounded-2xl border border-[#e4d7cc] bg-white p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold text-[#2e231c]">{study.title}</h2>
                    <p className="text-[#6f5b4f]">{study.productName}</p>
                    {study.attribution && (
                      <p className="text-xs font-medium text-[#1e4f8f]">{study.attribution}</p>
                    )}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.category}</span>
                      <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.stage}</span>
                      <span className="rounded-full bg-[#f6ede5] px-2.5 py-1 text-[#695446]">{study.status}</span>
                      <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[#1e4f8f]">
                        Responses {study._count.responses}/{study.sampleSize}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link
                      href={`/studies/${study.id}/form`}
                      className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                    >
                      Form + QR
                    </Link>
                    <Link
                      href={`/dashboard/${study.id}`}
                      className="inline-flex items-center justify-center rounded-lg border border-[#d8c7b8] px-4 py-2 text-sm font-medium text-[#5a4536] hover:bg-[#fff6ed]"
                    >
                      Result
                    </Link>
                    {targetReached ? (
                      <span className="inline-flex items-center justify-center rounded-lg bg-[#e8f8ed] px-4 py-2 text-sm font-medium text-[#1d7c4a]">
                        All Participants Completed
                      </span>
                    ) : isClosedBelowTarget ? (
                      <span className="inline-flex items-center justify-center rounded-lg bg-[#fde7e7] px-4 py-2 text-sm font-medium text-[#b3261e]">
                        Closed — Below Target
                      </span>
                    ) : !hasAnyParticipants ? (
                      <span className="inline-flex items-center justify-center rounded-lg bg-[#fff7e9] px-4 py-2 text-sm font-medium text-[#8a5a00]">
                        No Participants Assigned Yet
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center rounded-lg bg-[#edf5ff] px-4 py-2 text-sm font-medium text-[#1e4f8f]">
                        Awaiting Consumer Responses
                      </span>
                    )}
                  </div>
                </div>
                {isClosedBelowTarget && (
                  <RepostStudyControl
                    studyId={study.id}
                    sampleSize={study.sampleSize}
                    responsesCount={study._count.responses}
                  />
                )}
                <StudyDeleteControl studyId={study.id} redirectTo={redirectTo} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function groupStudyPipeline(studies: StudyPipelineItem[]) {
  const groups = [
    {
      key: "scheduled",
      title: "Scheduled",
      description: "Set up or recruiting studies with no collected responses yet.",
      studies: [] as StudyPipelineItem[],
    },
    {
      key: "in-progress",
      title: "In Progress",
      description: "Studies with active collection, analysis, or partial response progress.",
      studies: [] as StudyPipelineItem[],
    },
    {
      key: "completed",
      title: "Completed",
      description: "Studies that reached their target responses or are marked completed/archived.",
      studies: [] as StudyPipelineItem[],
    },
  ];
  const groupByKey = new Map(groups.map((group) => [group.key, group]));

  studies.forEach((study) => {
    groupByKey.get(getStudyPipelineKey(study))?.studies.push(study);
  });

  return groups;
}

function getStudyPipelineKey(study: StudyPipelineItem) {
  if (study.status === "COMPLETED" || study.status === "ARCHIVED" || study._count.responses >= study.sampleSize) {
    return "completed";
  }
  if (study.status === "DRAFT" || (study.status === "RECRUITING" && study._count.responses === 0)) {
    return "scheduled";
  }
  return "in-progress";
}
