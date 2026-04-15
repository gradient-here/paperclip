import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CompanyDocument } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { companiesApi } from "../api/companies";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime, issueUrl } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { MarkdownBody } from "../components/MarkdownBody";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Download, FileText, Pencil, Plus, Save, X } from "lucide-react";

export function CompanyDocuments() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createIssueId, setCreateIssueId] = useState("");
  const [createKey, setCreateKey] = useState("plan");
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("# New Document\n\n");

  const companyPrefix = selectedCompany?.issuePrefix ?? "COMPANY";

  useEffect(() => {
    setBreadcrumbs([{ label: "Documents" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.companyDocuments.list(selectedCompanyId!),
    queryFn: () => companiesApi.listDocuments(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const issueOptions = useMemo(() => {
    const values = issues ?? [];
    return [...values].sort((left, right) => {
      const leftRef = left.identifier ?? left.id;
      const rightRef = right.identifier ?? right.id;
      return leftRef.localeCompare(rightRef);
    });
  }, [issues]);

  const docsById = useMemo(() => {
    const map = new Map<string, CompanyDocument>();
    for (const doc of data ?? []) {
      map.set(doc.id, doc);
    }
    return map;
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (input: {
      issueId: string;
      key: string;
      title: string | null;
      format: "markdown";
      body: string;
      baseRevisionId: string;
    }) =>
      issuesApi.upsertDocument(input.issueId, input.key, {
        title: input.title,
        format: input.format,
        body: input.body,
        baseRevisionId: input.baseRevisionId,
      }),
    onSuccess: async (_saved, variables) => {
      if (!selectedCompanyId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companyDocuments.list(selectedCompanyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(variables.issueId) }),
      ]);
      pushToast({
        title: "Document updated",
        body: "Saved latest revision.",
        tone: "success",
      });
      setEditingDocId(null);
      setDraftBody("");
    },
    onError: (err) => {
      pushToast({
        title: "Could not save document",
        body: err instanceof Error ? err.message : "Please try again.",
        tone: "error",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: { issueId: string; key: string; title: string | null; body: string }) =>
      issuesApi.upsertDocument(input.issueId, input.key, {
        title: input.title,
        format: "markdown",
        body: input.body,
      }),
    onSuccess: async (_saved, variables) => {
      if (!selectedCompanyId) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.companyDocuments.list(selectedCompanyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(variables.issueId) }),
      ]);
      pushToast({
        title: "Document created",
        body: "New document added.",
        tone: "success",
      });
      setCreateOpen(false);
      setCreateKey("plan");
      setCreateTitle("");
      setCreateBody("# New Document\n\n");
    },
    onError: (err) => {
      pushToast({
        title: "Could not create document",
        body: err instanceof Error ? err.message : "Please try again.",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (!createIssueId && issueOptions.length > 0) {
      setCreateIssueId(issueOptions[0]!.id);
    }
  }, [createIssueId, issueOptions]);

  function buildDocumentPath(issueRef: string, key: string) {
    return `${companyPrefix}/documents/${issueRef}/${key}.md`;
  }

  function normalizeDocumentKey(value: string) {
    return value.trim().toLowerCase();
  }

  const normalizedCreateKey = normalizeDocumentKey(createKey);
  const createKeyIsValid = /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedCreateKey);
  const createCanSubmit =
    createIssueId.length > 0 && createKeyIsValid && createBody.trim().length > 0 && !createMutation.isPending;

  async function submitCreate() {
    if (!createCanSubmit) return;
    await createMutation.mutateAsync({
      issueId: createIssueId,
      key: normalizedCreateKey,
      title: createTitle.trim() ? createTitle.trim() : null,
      body: createBody,
    });
  }

  async function copyDocumentPath(path: string) {
    const fullPath = path.startsWith("/") ? path : `/${path}`;
    try {
      await navigator.clipboard.writeText(fullPath);
      pushToast({
        title: "Path copied",
        body: fullPath,
        tone: "success",
      });
    } catch {
      pushToast({
        title: "Copy failed",
        body: "Clipboard permission was denied.",
        tone: "error",
      });
    }
  }

  function downloadDocumentFile(filePath: string, body: string) {
    const filename = filePath.split("/").pop() ?? "document.md";
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startEditing(docId: string) {
    const current = docsById.get(docId);
    if (!current) return;
    setEditingDocId(docId);
    setDraftBody(current.body);
  }

  function cancelEditing() {
    setEditingDocId(null);
    setDraftBody("");
  }

  async function saveEditing(docId: string) {
    const doc = docsById.get(docId);
    if (!doc || !doc.latestRevisionId) {
      pushToast({
        title: "Could not save",
        body: "This document has no base revision.",
        tone: "error",
      });
      return;
    }

    await saveMutation.mutateAsync({
      issueId: doc.issueId,
      key: doc.key,
      title: doc.title,
      format: doc.format,
      body: draftBody,
      baseRevisionId: doc.latestRevisionId,
    });
  }

  if (!selectedCompanyId) {
    return <EmptyState icon={FileText} message="Select a company to view documents." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Document
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {data && data.length === 0 && (
        <EmptyState icon={FileText} message="No documents yet." />
      )}

      {data && data.length > 0 && (
        <div className="border border-border divide-y divide-border">
          {data.map((doc) => {
            const issueRef = doc.issueIdentifier ?? doc.issueId;
            const title = doc.title?.trim() || doc.key;
            const generatedByAgent = Boolean(doc.createdByAgentId || doc.updatedByAgentId);
            const documentPath = buildDocumentPath(issueRef, doc.key);
            const isEditing = editingDocId === doc.id;
            const isSaving = saveMutation.isPending && isEditing;

            return (
              <details key={doc.id} className="group bg-background">
                <summary className="cursor-pointer list-none px-4 py-3 bg-muted/30 border-b border-border hover:bg-muted/50 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {issueRef} • rev {doc.latestRevisionNumber} • {formatDateTime(doc.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{generatedByAgent ? "Agent-built" : "Board-authored"}</span>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void copyDocumentPath(documentPath);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy path
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          downloadDocumentFile(documentPath, doc.body);
                        }}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download file
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 underline underline-offset-2"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (isEditing) {
                            cancelEditing();
                            return;
                          }
                          startEditing(doc.id);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {isEditing ? "Close edit" : "Edit"}
                      </button>
                      <Link to={issueUrl({ id: doc.issueId, identifier: doc.issueIdentifier })} className="underline underline-offset-2">
                        View issue
                      </Link>
                    </div>
                  </div>
                </summary>
                <div className="px-4 pt-3 pb-4 bg-background">
                  <p className="mb-2 text-xs text-muted-foreground">{doc.issueTitle}</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Path: <span className="font-mono">{documentPath}</span>
                  </p>

                  {isEditing ? (
                    <div className="space-y-3">
                      <MarkdownEditor
                        value={draftBody}
                        onChange={setDraftBody}
                        placeholder="Edit document markdown..."
                      />
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => void saveEditing(doc.id)} disabled={isSaving}>
                          <Save className="h-4 w-4 mr-1" />
                          {isSaving ? "Saving..." : "Save"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={cancelEditing} disabled={isSaving}>
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[640px] overflow-y-auto">
                      <MarkdownBody>{doc.body}</MarkdownBody>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[min(96vw,1100px)] max-w-4xl flex flex-col max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>Create Document</DialogTitle>
            <DialogDescription>
              Add a new markdown document to an issue for this company.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 overflow-y-auto min-h-0 flex-1">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-1.5 min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Issue</p>
                <Select value={createIssueId} onValueChange={setCreateIssueId}>
                  <SelectTrigger className="w-full min-w-0 max-w-full overflow-hidden">
                    <SelectValue className="block truncate" placeholder="Select issue" />
                  </SelectTrigger>
                  <SelectContent>
                    {issueOptions.map((issue) => (
                      <SelectItem key={issue.id} value={issue.id}>
                        {(issue.identifier ?? issue.id)} — {issue.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Document key</p>
                <Input
                  value={createKey}
                  onChange={(event) => setCreateKey(event.target.value)}
                  placeholder="plan"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {!createKeyIsValid && (
                  <p className="text-xs text-destructive">
                    Use lowercase letters, numbers, dashes, or underscores (max 64 chars).
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Title (optional)</p>
              <Input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="Document title"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Body</p>
              <MarkdownEditor
                value={createBody}
                onChange={setCreateBody}
                placeholder="Write markdown..."
              />
            </div>

            {issueOptions.length === 0 && (
              <p className="text-xs text-destructive">Create an issue first, then add documents.</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitCreate()} disabled={!createCanSubmit}>
              {createMutation.isPending ? "Creating..." : "Create Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
