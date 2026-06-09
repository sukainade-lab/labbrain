import { describe, it, expect } from "vitest";
import {
  serviceTabNameSchema,
  createServiceTabSchema,
  deleteServiceTabSchema,
  documentWorkspaceSchema,
  isValidSection,
  SECTIONS_BY_PANEL,
  SERVICE_TAB_NAME_MAX
} from "@/lib/validation/workspace";

// S18 — pure workspace validation (AC-2.1 / AC-2.4). No DB, runs anywhere.

describe("serviceTabNameSchema (AC-2.1)", () => {
  it("@AC-2.1 accepts a trimmed mixed-script name", () => {
    const r = serviceTabNameSchema.safeParse("  خدمة المعايرة Calibration  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("خدمة المعايرة Calibration");
  });

  it("@AC-2.1 rejects an empty / whitespace-only name", () => {
    expect(serviceTabNameSchema.safeParse("").success).toBe(false);
    expect(serviceTabNameSchema.safeParse("    ").success).toBe(false);
  });

  it("@AC-2.1 rejects a name over the length cap", () => {
    expect(serviceTabNameSchema.safeParse("ء".repeat(SERVICE_TAB_NAME_MAX + 1)).success).toBe(false);
  });

  it("@AC-2.1 createServiceTabSchema requires a name field", () => {
    expect(createServiceTabSchema.safeParse({}).success).toBe(false);
    expect(createServiceTabSchema.safeParse({ name: "References" }).success).toBe(true);
  });

  it("@AC-2.1 deleteServiceTabSchema requires a uuid id", () => {
    expect(deleteServiceTabSchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(
      deleteServiceTabSchema.safeParse({ id: "11111111-1111-1111-1111-111111111111" }).success
    ).toBe(true);
  });
});

describe("documentWorkspaceSchema (AC-2.4)", () => {
  it("@AC-2.8 defaults an empty payload into Existing Services / references", () => {
    const r = documentWorkspaceSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.panel_type).toBe("existing");
      expect(r.data.service_tab_id ?? null).toBeNull();
      expect(r.data.doc_section).toBe("references");
    }
  });

  it("@AC-2.4 accepts a valid new_service upload with a tab + New Service section", () => {
    const r = documentWorkspaceSchema.safeParse({
      panel_type: "new_service",
      service_tab_id: "11111111-1111-1111-1111-111111111111",
      doc_section: "available_equipment"
    });
    expect(r.success).toBe(true);
  });

  it("@AC-2.4 rejects new_service WITHOUT a service_tab_id", () => {
    const r = documentWorkspaceSchema.safeParse({
      panel_type: "new_service",
      doc_section: "references"
    });
    expect(r.success).toBe(false);
  });

  it("@AC-2.4 rejects existing WITH a service_tab_id", () => {
    const r = documentWorkspaceSchema.safeParse({
      panel_type: "existing",
      service_tab_id: "11111111-1111-1111-1111-111111111111",
      doc_section: "sops"
    });
    expect(r.success).toBe(false);
  });

  it("@AC-2.4 rejects a section from the wrong panel's vocabulary", () => {
    // 'sops' is an Existing section, not valid for a New Service panel.
    const r = documentWorkspaceSchema.safeParse({
      panel_type: "new_service",
      service_tab_id: "11111111-1111-1111-1111-111111111111",
      doc_section: "sops"
    });
    expect(r.success).toBe(false);
  });

  it("@AC-2.1 isValidSection matches the per-panel vocabularies", () => {
    expect(isValidSection("existing", "sops")).toBe(true);
    expect(isValidSection("existing", "available_equipment")).toBe(false);
    expect(isValidSection("new_service", "additional_info")).toBe(true);
    expect(isValidSection("new_service", "equipment")).toBe(false);
    // Both panels share 'references'.
    expect(SECTIONS_BY_PANEL.existing).toContain("references");
    expect(SECTIONS_BY_PANEL.new_service).toContain("references");
  });
});
