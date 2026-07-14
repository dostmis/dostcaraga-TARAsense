"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Trash2, Upload, Link2, Plus } from "lucide-react";
import type { ProjectStatus } from "@prisma/client";
import {
  archiveProject,
  setProjectStatus,
  addProjectNote,
  updateProjectNote,
  deleteProjectNote,
  uploadProjectFile,
  deleteProjectFileRecord,
  linkStudyToProject,
  unlinkStudyFromProject,
} from "@/app/actions/project-actions";
import { PROJECT_STATUS_OPTIONS } from "@/lib/projects/labels";

function useAction() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.success) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  };
  return { run, isPending, error };
}

const secondaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc] disabled:opacity-60";

/* ------------------------------- Status ------------------------------- */

export function ProjectStatusControl({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const { run, isPending } = useAction();
  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => run(() => setProjectStatus(projectId, e.target.value as ProjectStatus))}
      className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm font-semibold text-[#334155] outline-none focus:border-[#fdba74]"
      aria-label="Project status"
    >
      {PROJECT_STATUS_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ArchiveProjectButton({ projectId }: { projectId: string }) {
  const { run, isPending } = useAction();
  const [confirm, setConfirm] = useState(false);
  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className={secondaryBtn}>
        <Archive size={14} /> Archive
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => archiveProject(projectId))}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
      >
        <Archive size={14} /> Confirm
      </button>
      <button type="button" onClick={() => setConfirm(false)} className={secondaryBtn}>
        Cancel
      </button>
    </span>
  );
}

/* -------------------------------- Files ------------------------------- */

export function ProjectFileUpload({ projectId }: { projectId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.append("projectId", projectId);
    formData.append("file", file);
    startTransition(async () => {
      const result = await uploadProjectFile(formData);
      if (inputRef.current) inputRef.current.value = "";
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(249,115,22,0.24)] transition hover:bg-[#ea580c]">
        <Upload size={15} />
        {isPending ? "Uploading…" : "Upload File"}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png"
          onChange={onChange}
          disabled={isPending}
        />
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function DeleteProjectFileButton({ fileId }: { fileId: string }) {
  const { run, isPending } = useAction();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => run(() => deleteProjectFileRecord(fileId))}
      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
    >
      <Trash2 size={13} /> Delete
    </button>
  );
}

/* -------------------------------- Notes ------------------------------- */

export function AddProjectNote({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await addProjectNote({ projectId, body: body.trim() });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setBody("");
      router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="Formulation ideas, target-market observations, issues found in the study, packaging direction, next steps…"
        className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-sm text-[#1e293b] outline-none focus:border-[#fdba74]"
      />
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !body.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#ea580c] disabled:opacity-60"
        >
          <Plus size={15} /> {isPending ? "Adding…" : "Add Note"}
        </button>
      </div>
    </div>
  );
}

export function ProjectNoteItem({
  noteId,
  body,
  meta,
}: {
  noteId: string;
  body: string;
  meta: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateProjectNote(noteId, draft.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteProjectNote(noteId);
      if (result.success) router.refresh();
    });
  };

  return (
    <article className="rounded-xl border border-[#e2e8f0] bg-white p-4">
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#1e293b] outline-none focus:border-[#fdba74]"
          />
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={save} disabled={isPending} className="rounded-lg bg-[#f97316] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#ea580c] disabled:opacity-60">
              Save
            </button>
            <button type="button" onClick={() => { setEditing(false); setDraft(body); }} className="rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-xs font-semibold text-[#334155]">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-[#1e293b]">{body}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-[#94a3b8]">{meta}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-[#c2410c] hover:underline">
                Edit
              </button>
              <button type="button" onClick={remove} disabled={isPending} className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-60">
                Delete
              </button>
            </span>
          </div>
        </>
      )}
    </article>
  );
}

/* -------------------------------- Studies ----------------------------- */

export function LinkExistingStudy({
  projectId,
  studies,
}: {
  projectId: string;
  studies: { id: string; title: string }[];
}) {
  const { run, isPending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");

  if (studies.length === 0) {
    return (
      <span className={secondaryBtn + " cursor-not-allowed opacity-60"} title="No unlinked studies available">
        <Link2 size={14} /> Link Existing Study
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryBtn}>
        <Link2 size={14} /> Link Existing Study
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#334155] outline-none focus:border-[#fdba74]"
      >
        <option value="">Select a study…</option>
        {studies.map((study) => (
          <option key={study.id} value={study.id}>
            {study.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!selected || isPending}
        onClick={() => run(() => linkStudyToProject(projectId, selected))}
        className="rounded-lg bg-[#f97316] px-3 py-2 text-sm font-semibold text-white hover:bg-[#ea580c] disabled:opacity-60"
      >
        Link
      </button>
      <button type="button" onClick={() => setOpen(false)} className={secondaryBtn}>
        Cancel
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}

export function UnlinkStudyButton({ projectId, studyId }: { projectId: string; studyId: string }) {
  const { run, isPending } = useAction();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => run(() => unlinkStudyFromProject(projectId, studyId))}
      className="inline-flex items-center justify-center rounded-lg border border-[#e2e8f0] px-3 py-2 text-sm font-medium text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-60"
    >
      Unlink
    </button>
  );
}
