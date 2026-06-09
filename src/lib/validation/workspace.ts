import { z } from "zod";

// S18 — two-panel workspace validation (AC-2.1 / AC-2.4).
// Section vocabularies differ by panel and are enforced HERE (app-side), not as a
// DB check, so the two product vocabularies can evolve without a migration. The DB
// only constrains panel_type ('existing' | 'new_service'); doc_section is free text.

export const PANEL_TYPES = ["existing", "new_service"] as const;
export type PanelType = (typeof PANEL_TYPES)[number];

// The permanent "خدماتي الحالية" (Existing Services) sections vs. the dynamic
// "خدمة جديدة" (New Service) sections — the two vocabularies the UI sub-tabs render.
export const SECTIONS_BY_PANEL: Record<PanelType, readonly string[]> = {
  existing: ["sops", "references", "equipment"],
  new_service: ["references", "available_equipment", "additional_info"]
} as const;

// Service-tab display name: a lab-supplied, mixed-script string (Arabic/Latin), so
// it is `<bdi>`-wrapped wherever rendered (L5). Trim + length cap keep it sane.
export const SERVICE_TAB_NAME_MAX = 80;

export const serviceTabNameSchema = z
  .string()
  .trim()
  .min(1, "اسم الخدمة مطلوب")
  .max(SERVICE_TAB_NAME_MAX, `الحد الأقصى ${SERVICE_TAB_NAME_MAX} حرفًا`);

export const createServiceTabSchema = z.object({
  name: serviceTabNameSchema
});

export const deleteServiceTabSchema = z.object({
  id: z.string().uuid("معرّف غير صالح")
});

// Workspace tags carried by an upload. Cross-field rules (AC-2.4):
//   • new_service  → MUST name a service_tab_id (which the route then verifies the
//                    tenant owns), and doc_section must be a New Service section.
//   • existing     → service_tab_id MUST be absent/null, doc_section an Existing one.
// Defaults (untagged upload) land in Existing Services / references (AC-2.8).
export const documentWorkspaceSchema = z
  .object({
    panel_type: z.enum(PANEL_TYPES).default("existing"),
    service_tab_id: z.string().uuid("معرّف الخدمة غير صالح").nullish(),
    doc_section: z.string().trim().min(1).default("references")
  })
  .superRefine((val, ctx) => {
    if (val.panel_type === "new_service" && !val.service_tab_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["service_tab_id"],
        message: "خدمة جديدة تتطلب اختيار تبويب خدمة"
      });
    }
    if (val.panel_type === "existing" && val.service_tab_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["service_tab_id"],
        message: "الخدمات الحالية لا ترتبط بتبويب خدمة"
      });
    }
    if (!SECTIONS_BY_PANEL[val.panel_type].includes(val.doc_section)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["doc_section"],
        message: "القسم غير صالح لهذا النوع من اللوحات"
      });
    }
  });

export type DocumentWorkspace = z.infer<typeof documentWorkspaceSchema>;

// True iff `section` is a valid sub-tab for `panel` (used by the UI to render the
// section sub-tabs and by the schema above).
export function isValidSection(panel: PanelType, section: string): boolean {
  return SECTIONS_BY_PANEL[panel]?.includes(section) ?? false;
}
