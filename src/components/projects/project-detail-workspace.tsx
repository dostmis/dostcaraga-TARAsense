import Link from "next/link";
import {
  ArrowLeft,
  PlusCircle,
  FlaskConical,
  FileText,
  StickyNote,
  Sparkles,
  Activity as ActivityIcon,
  LayoutList,
  Download,
  ExternalLink,
  Info,
} from "lucide-react";
import { prisma } from "@/lib/db";
import {
  formatCategory,
  formatProjectStatus,
  PROJECT_STATUS_BADGE,
} from "@/lib/projects/labels";
import { ProjectFormModal, type ProjectFormValues } from "@/components/projects/project-form-modal";
import {
  ArchiveProjectButton,
  ProjectStatusControl,
  ProjectFileUpload,
  DeleteProjectFileButton,
  AddProjectNote,
  ProjectNoteItem,
  LinkExistingStudy,
  UnlinkStudyButton,
} from "@/components/projects/project-controls";

const TABS = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "studies", label: "Studies", icon: FlaskConical },
  { key: "files", label: "Files", icon: FileText },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "ai", label: "AI Workspace", icon: Sparkles },
  { key: "activity", label: "Activity", icon: ActivityIcon },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function parseTab(value?: string): TabKey {
  return TABS.some((tab) => tab.key === value) ? (value as TabKey) : "overview";
}

export async function ProjectDetailWorkspace({
  projectId,
  userId,
  isAdmin,
  tab,
}: {
  projectId: string;
  userId: string;
  isAdmin: boolean;
  tab?: string;
}) {
  const activeTab = parseTab(tab);

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      studies: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { responses: true, participants: true } } },
      },
      files: { orderBy: { createdAt: "desc" } },
      noteEntries: { orderBy: { createdAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });

  if (!project || (project.creatorId !== userId && !isAdmin)) {
    return (
      <section className="rounded-2xl border border-[#e2e8f0] bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-[#0f172a]">Project not found</h2>
        <p className="mt-1 text-sm text-[#64748b]">This project may have been removed or you do not have access.</p>
        <Link href="/msme/dashboard?view=projects" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#c2410c] hover:underline">
          <ArrowLeft size={15} /> Back to Projects
        </Link>
      </section>
    );
  }

  // Names for uploaders / note authors.
  const userIds = Array.from(
    new Set([...project.files.map((f) => f.uploadedById), ...project.noteEntries.map((n) => n.authorId)])
  );
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  // Unlinked studies the caller owns (for "Link Existing Study").
  const linkableStudies = await prisma.study.findMany({
    where: { creatorId: project.creatorId, projectId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
    take: 50,
  });

  const totalResponses = project.studies.reduce((sum, s) => sum + s._count.responses, 0);
  const totalEvaluations = project.studies.reduce((sum, s) => sum + s._count.participants, 0);
  const aiSources = project.studies.length + project.files.length + (project.noteEntries.length > 0 ? 1 : 0);

  const base = `/msme/dashboard?view=projects&projectId=${project.id}`;
  const dateFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
  const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  const editInitial: Partial<ProjectFormValues> = {
    name: project.name,
    category: project.category,
    targetConsumer: project.targetConsumer,
    targetPrice: project.targetPrice,
    description: project.description,
    productType: project.productType ?? "",
    innovationStage: project.innovationStage ?? "",
    objectives: project.objectives ?? "",
    keyIngredients: project.keyIngredients ?? "",
    intendedMarket: project.intendedMarket ?? "",
    notes: project.notes ?? "",
  };

  return (
    <div className="space-y-5">
      <Link href="/msme/dashboard?view=projects" className="inline-flex items-center gap-2 text-sm font-semibold text-[#64748b] hover:text-[#334155]">
        <ArrowLeft size={15} /> Back to Projects
      </Link>

      {/* Header */}
      <header className="rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-[#0f172a]">{project.name}</h1>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${PROJECT_STATUS_BADGE[project.status]}`}>
                {formatProjectStatus(project.status)}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium text-[#64748b]">{formatCategory(project.category)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProjectStatusControl projectId={project.id} status={project.status} />
            <ProjectFormModal
              mode="edit"
              projectId={project.id}
              initial={editInitial}
              triggerClassName="inline-flex items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
            />
            <ArchiveProjectButton projectId={project.id} />
            <Link
              href={`/msme/dashboard?view=create-study&projectId=${project.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(249,115,22,0.24)] hover:bg-[#ea580c]"
            >
              <PlusCircle size={16} /> Create Study
            </Link>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-[#e2e8f0] bg-white p-1.5">
        {TABS.map((t) => {
          const active = t.key === activeTab;
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={t.key === "overview" ? base : `${base}&tab=${t.key}`}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                active
                  ? "bg-[#fff7ed] text-[#c2410c]"
                  : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#334155]"
              }`}
            >
              <Icon size={15} /> {t.label}
            </Link>
          );
        })}
      </nav>

      {/* ------------------------------- Overview ------------------------------ */}
      {activeTab === "overview" && (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="Linked Studies" value={project.studies.length} tone="sky" />
            <SummaryCard label="Responses Collected" value={totalResponses} tone="mint" />
            <SummaryCard label="Evaluations" value={totalEvaluations} tone="amber" />
            <SummaryCard label="Files Uploaded" value={project.files.length} tone="slate" />
            <SummaryCard label="AI Sources Available" value={aiSources} tone="violet" />
          </section>

          <section className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
            <h2 className="text-lg font-semibold text-[#0f172a]">Product Concept</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Detail label="Project Name" value={project.name} />
              <Detail label="Category" value={formatCategory(project.category)} />
              <Detail label="Target Consumer" value={project.targetConsumer} />
              <Detail label="Target Price" value={project.targetPrice} />
              <Detail label="Description" value={project.description} full />
              {project.productType && <Detail label="Product Type" value={project.productType} />}
              {project.innovationStage && <Detail label="Innovation Stage" value={project.innovationStage} />}
              {project.intendedMarket && <Detail label="Intended Market" value={project.intendedMarket} />}
              {project.objectives && <Detail label="Objectives" value={project.objectives} full />}
              {project.keyIngredients && <Detail label="Key Ingredients" value={project.keyIngredients} full />}
              {project.notes && <Detail label="Notes" value={project.notes} full />}
            </dl>
          </section>
        </div>
      )}

      {/* -------------------------------- Studies ------------------------------ */}
      {activeTab === "studies" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Studies</h2>
              <p className="text-sm text-[#64748b]">Connect sensory studies to this product concept.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkExistingStudy projectId={project.id} studies={linkableStudies} />
              <Link
                href={`/msme/dashboard?view=create-study&projectId=${project.id}`}
                className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(249,115,22,0.24)] hover:bg-[#ea580c]"
              >
                <PlusCircle size={16} /> Create Study
              </Link>
            </div>
          </div>

          {project.studies.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No studies linked yet" description="Create a new study or link an existing one to start collecting sensory responses for this project." />
          ) : (
            <div className="space-y-3">
              {project.studies.map((study) => (
                <article key={study.id} className="rounded-2xl border border-[#e2e8f0] bg-white p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <h3 className="text-base font-semibold text-[#0f172a]">{study.title}</h3>
                      <p className="text-sm text-[#64748b]">{study.productName}</p>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge>{formatCategory(study.category)}</Badge>
                        <Badge>{study.stage.replace(/_/g, " ")}</Badge>
                        <Badge>{study.status}</Badge>
                        <span className="rounded-full bg-[#edf5ff] px-2.5 py-1 text-[#1e4f8f]">
                          Responses {study._count.responses}/{study.sampleSize}
                        </span>
                        <span className="text-[#94a3b8]">Created {dateFmt.format(study.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link
                        href={`/dashboard/${study.id}`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-4 py-2 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
                      >
                        Open Study <ExternalLink size={14} />
                      </Link>
                      <UnlinkStudyButton projectId={project.id} studyId={study.id} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* --------------------------------- Files ------------------------------- */}
      {activeTab === "files" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0f172a]">Files</h2>
              <p className="text-sm text-[#64748b]">Concept notes, formulation drafts, packaging, competitor analysis, and more.</p>
            </div>
            <ProjectFileUpload projectId={project.id} />
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] px-4 py-3 text-sm text-[#5b21b6]">
            <Info size={16} className="mt-0.5 shrink-0" />
            These files will be used in the future by TARAsense AI as grounded project sources.
          </p>

          {project.files.length === 0 ? (
            <EmptyState icon={FileText} title="No files uploaded" description="Upload PDF, DOCX, XLSX, CSV, JPG, or PNG documents to support product development." />
          ) : (
            <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-[#f8fafc] text-left text-xs uppercase tracking-wide text-[#94a3b8]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">File name</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Uploaded</th>
                    <th className="px-4 py-3 font-semibold">By</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f1f5f9]">
                  {project.files.map((file) => (
                    <tr key={file.id}>
                      <td className="max-w-[220px] truncate px-4 py-3 font-medium text-[#1e293b]">{file.fileName}</td>
                      <td className="px-4 py-3 text-[#64748b]">{extOf(file.fileName)}</td>
                      <td className="px-4 py-3 text-[#64748b]">{dateFmt.format(file.createdAt)}</td>
                      <td className="px-4 py-3 text-[#64748b]">{nameById.get(file.uploadedById) ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <a
                            href={`/api/uploads/project-file/${file.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] px-2.5 py-1.5 text-xs font-semibold text-[#334155] hover:bg-[#f8fafc]"
                          >
                            <Download size={13} /> Download
                          </a>
                          <DeleteProjectFileButton fileId={file.id} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* --------------------------------- Notes ------------------------------- */}
      {activeTab === "notes" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[#0f172a]">Notes</h2>
            <p className="text-sm text-[#64748b]">Capture formulation ideas, observations, and next steps.</p>
          </div>
          <AddProjectNote projectId={project.id} />
          {project.noteEntries.length === 0 ? (
            <EmptyState icon={StickyNote} title="No notes yet" description="Add your first note to start documenting product direction." />
          ) : (
            <div className="space-y-3">
              {project.noteEntries.map((note) => (
                <ProjectNoteItem
                  key={note.id}
                  noteId={note.id}
                  body={note.body}
                  meta={`${nameById.get(note.authorId) ?? "You"} · ${dateTimeFmt.format(note.updatedAt)}`}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------ AI Workspace --------------------------- */}
      {activeTab === "ai" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-[#ddd6fe] bg-gradient-to-br from-[#f5f3ff] to-white p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#ddd6fe] bg-white text-[#7c3aed]">
                <Sparkles size={20} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-[#0f172a]">TARAsense AI Workspace</h2>
                <p className="text-sm text-[#64748b]">
                  Use grounded project information, uploaded documents, and sensory study data to assist product development.
                </p>
              </div>
            </div>

            <p className="mt-5 rounded-xl border border-[#e2e8f0] bg-white p-4 text-sm text-[#475569]">
              TARAsense AI will use your project details, uploaded sources, and sensory study data to help generate
              grounded product development insights. It only works from this project’s grounded data.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SourceCounter label="Linked Studies" value={project.studies.length} />
              <SourceCounter label="Uploaded Files" value={project.files.length} />
              <SourceCounter label="Notes Collection" value={project.noteEntries.length > 0 ? 1 : 0} />
              <SourceCounter label="Responses Available" value={totalResponses} />
            </div>
          </div>

          <div className="rounded-2xl border border-[#e2e8f0] bg-white p-6">
            <h3 className="text-sm font-semibold text-[#0f172a]">Suggested actions</h3>
            <p className="text-xs text-[#94a3b8]">Coming soon — grounded on this project’s data.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                "Summarize project insights",
                "Suggest product improvements",
                "Identify possible sensory issues",
                "Recommend next studies",
                "Extract themes from responses",
                "Suggest positioning for the target consumer",
                "Help develop product direction",
              ].map((action) => (
                <span
                  key={action}
                  className="cursor-not-allowed rounded-full border border-dashed border-[#ddd6fe] bg-[#f5f3ff] px-3.5 py-1.5 text-xs font-medium text-[#7c3aed]"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* -------------------------------- Activity ----------------------------- */}
      {activeTab === "activity" && (
        <section className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-[#0f172a]">Activity</h2>
            <p className="text-sm text-[#64748b]">Timeline of actions taken on this project.</p>
          </div>
          {project.activities.length === 0 ? (
            <EmptyState icon={ActivityIcon} title="No activity yet" description="Actions on this project will appear here." />
          ) : (
            <ol className="relative space-y-4 border-l border-[#e2e8f0] pl-6">
              {project.activities.map((activity) => (
                <li key={activity.id} className="relative">
                  <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-[#f97316]" />
                  <p className="text-sm font-medium text-[#1e293b]">{activity.summary}</p>
                  <p className="text-xs text-[#94a3b8]">{dateTimeFmt.format(activity.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

const toneStyles: Record<string, string> = {
  mint: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  sky: "border-blue-200 bg-blue-50 text-blue-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <span className={`inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${toneStyles[tone]}`}>
        {label}
      </span>
      <p className="mt-3 text-2xl font-semibold text-[#0f172a]">{value}</p>
    </article>
  );
}

function SourceCounter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 text-center">
      <p className="text-2xl font-semibold text-[#7c3aed]">{value}</p>
      <p className="mt-1 text-xs font-medium text-[#64748b]">{label}</p>
    </div>
  );
}

function Detail({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#94a3b8]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-[#1e293b]">{value}</dd>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-[#475569]">{children}</span>;
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FlaskConical;
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-dashed border-[#e2e8f0] bg-white p-10 text-center">
      <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#e2e8f0] bg-[#f8fafc] text-[#64748b]">
        <Icon size={22} />
      </span>
      <h3 className="mt-4 text-base font-semibold text-[#0f172a]">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-[#64748b]">{description}</p>
    </section>
  );
}

function extOf(fileName: string): string {
  const ext = fileName.split(".").pop();
  return ext && ext !== fileName ? ext.toUpperCase() : "FILE";
}
