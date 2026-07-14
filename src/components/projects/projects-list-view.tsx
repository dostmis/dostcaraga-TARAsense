import Link from "next/link";
import { Search, FolderKanban, FlaskConical, ArrowRight } from "lucide-react";
import { Prisma, ProductCategory, ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ProjectFormModal } from "@/components/projects/project-form-modal";
import {
  CATEGORY_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  PROJECT_STATUS_BADGE,
  formatCategory,
  formatProjectStatus,
} from "@/lib/projects/labels";

const BASE = "/msme/dashboard?view=projects";

function isCategory(value?: string): value is ProductCategory {
  return !!value && (Object.values(ProductCategory) as string[]).includes(value);
}
function isStatus(value?: string): value is ProjectStatus {
  return !!value && (Object.values(ProjectStatus) as string[]).includes(value);
}

export async function ProjectsListView({
  userId,
  q,
  category,
  status,
}: {
  userId: string;
  q?: string;
  category?: string;
  status?: string;
}) {
  const query = (q ?? "").trim();
  const categoryFilter = isCategory(category) ? category : undefined;
  const statusFilter = isStatus(status) ? status : undefined;

  const where: Prisma.ProjectWhereInput = {
    creatorId: userId,
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { targetConsumer: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const projects = await prisma.project.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { studies: true } } },
    take: 60,
  });

  const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      <header className="border-b border-[#e2e8f0] pb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-[#64748b]">Innovator Workspace</p>
        <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight text-[#0f172a] sm:text-3xl">Projects</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#64748b]">
              Manage product development workspaces, connect studies, and organize supporting inputs for
              AI-assisted innovation.
            </p>
          </div>
          <ProjectFormModal mode="create" />
        </div>
      </header>

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input type="hidden" name="view" value="projects" />
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5">
          <Search size={16} className="shrink-0 text-[#64748b]" />
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search projects"
            className="w-full min-w-0 bg-transparent text-sm text-[#1e293b] outline-none placeholder:text-[#64748b]"
          />
        </div>
        <select name="category" defaultValue={categoryFilter ?? ""} className={filterClass}>
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={statusFilter ?? ""} className={filterClass}>
          <option value="">All statuses</option>
          {PROJECT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-[#e2e8f0] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]">
          Apply
        </button>
      </form>

      {projects.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-[#e2e8f0] bg-white p-10 text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]">
            <FolderKanban size={22} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-[#0f172a]">
            {query || categoryFilter || statusFilter ? "No matching projects" : "No projects yet"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#64748b]">
            {query || categoryFilter || statusFilter
              ? "Try clearing filters or searching a different term."
              : "Create your first project to define a product concept and connect sensory studies."}
          </p>
          <div className="mt-5 flex justify-center">
            <ProjectFormModal mode="create" />
          </div>
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <article
              key={project.id}
              className="flex flex-col rounded-2xl border border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:border-[#fdba74] hover:shadow-[0_10px_28px_rgba(249,115,22,0.10)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold text-[#0f172a]">{project.name}</h3>
                  <p className="mt-0.5 text-xs font-medium text-[#64748b]">{formatCategory(project.category)}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${PROJECT_STATUS_BADGE[project.status]}`}>
                  {formatProjectStatus(project.status)}
                </span>
              </div>

              <p className="mt-3 line-clamp-2 text-sm text-[#475569]">{project.description}</p>

              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[#94a3b8]">Target Consumer</dt>
                  <dd className="truncate font-medium text-[#334155]">{project.targetConsumer}</dd>
                </div>
                <div>
                  <dt className="text-[#94a3b8]">Target Price</dt>
                  <dd className="truncate font-medium text-[#334155]">{project.targetPrice}</dd>
                </div>
              </dl>

              <div className="mt-4 flex items-center gap-3 border-t border-[#f1f5f9] pt-3 text-xs text-[#64748b]">
                <span className="inline-flex items-center gap-1">
                  <FlaskConical size={13} className="text-[#f97316]" />
                  {project._count.studies} {project._count.studies === 1 ? "study" : "studies"}
                </span>
                <span className="text-[#cbd5e1]">•</span>
                <span>Updated {dateFmt.format(project.updatedAt)}</span>
              </div>

              <Link
                href={`${BASE}&projectId=${project.id}`}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-[#fff7ed] px-4 py-2.5 text-sm font-semibold text-[#c2410c] transition hover:bg-[#ffedd5]"
              >
                Open Project <ArrowRight size={15} />
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const filterClass =
  "rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm font-medium text-[#334155] outline-none focus:border-[#fdba74]";
