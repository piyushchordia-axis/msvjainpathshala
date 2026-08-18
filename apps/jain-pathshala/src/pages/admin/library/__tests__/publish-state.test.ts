/**
 * Draft-vs-published state, which the admin panel could not see.
 *
 * A published row whose draft had since been edited rendered identically to a
 * clean one: same "Published" badge, same controls. Nothing told the editor
 * their change was outstanding, and the super_admin — the only role that can
 * publish — had no list of what was waiting. Both copies of every field were
 * already in the DTO, so none of this needs a column or an endpoint.
 */
import { describe, expect, it } from "vitest";
import {
  hasUnpublishedChanges,
  pendingLibraryRows,
  type LibraryAdminItem,
  type LibraryAdminSection,
} from "@/pages/admin/library/library-admin-types";

function names(name: string) {
  return { name_en: name, name_hi: null, name_gu: null, order_index: 0 };
}

function sectionDraft(name: string) {
  return {
    ...names(name),
    icon_url: null,
    type: "item_list" as const,
    deeplink_target: null,
    requires_login: false,
  };
}

function itemFields(title: string, over: Record<string, unknown> = {}) {
  return {
    title_en: title,
    title_hi: null,
    title_gu: null,
    order_index: 0,
    audio_url: null,
    audio_size_bytes: null,
    audio_duration_sec: null,
    youtube_url: null,
    text_content_en: null,
    text_content_hi: null,
    text_content_gu: null,
    tarj_en: null,
    tarj_hi: null,
    pdf_url: null,
    pdf_size_bytes: null,
    pdf_page_count: null,
    external_url: null,
    ...over,
  };
}

function item(
  id: string,
  draftTitle: string,
  publishedTitle: string,
  is_published: boolean,
): LibraryAdminItem {
  return {
    id,
    section_id: "s1",
    subsection_id: null,
    item_code: id,
    is_published,
    content_version: 1,
    draft: itemFields(draftTitle),
    published: itemFields(publishedTitle),
  } as LibraryAdminItem;
}

function section(over: Partial<LibraryAdminSection> = {}): LibraryAdminSection {
  return {
    id: "s1",
    key: "stavans",
    is_published: true,
    content_version: 1,
    draft: sectionDraft("Stavans"),
    published: sectionDraft("Stavans"),
    subsections: [],
    items: [],
    ...over,
  } as LibraryAdminSection;
}

describe("hasUnpublishedChanges", () => {
  it("is true for a published row whose draft has moved", () => {
    // The exact case that was invisible.
    expect(hasUnpublishedChanges(item("i1", "Bhaktamar (revised)", "Bhaktamar", true))).toBe(
      true,
    );
  });

  it("is false for a published row that matches", () => {
    expect(hasUnpublishedChanges(item("i1", "Bhaktamar", "Bhaktamar", true))).toBe(false);
  });

  it("is false for a row that was never published", () => {
    // That is a draft, which the existing badge already says. Calling it
    // "changed" too would light the badge on a mostly-draft tree and make it
    // mean nothing.
    expect(hasUnpublishedChanges(item("i1", "New stavan", "", false))).toBe(false);
  });

  it("treats a cleared optional field and null as the same", () => {
    // The editor writes "" for a cleared Gujarati title; the API stores null.
    // Without this every such row would claim changes forever.
    const row = {
      is_published: true,
      draft: itemFields("Bhaktamar", { title_gu: "", tarj_en: "" }),
      published: itemFields("Bhaktamar", { title_gu: null, tarj_en: null }),
    };
    expect(hasUnpublishedChanges(row)).toBe(false);
  });

  it("notices a change in any field, not just the title", () => {
    const row = {
      is_published: true,
      draft: itemFields("Bhaktamar", { audio_url: "/uploads/new.mp3" }),
      published: itemFields("Bhaktamar", { audio_url: "/uploads/old.mp3" }),
    };
    expect(hasUnpublishedChanges(row)).toBe(true);
  });

  it("notices a field the published copy does not have at all", () => {
    const row = {
      is_published: true,
      draft: itemFields("Bhaktamar", { tarj_hi: "राग: भैरवी" }),
      published: itemFields("Bhaktamar"),
    };
    expect(hasUnpublishedChanges(row)).toBe(true);
  });
});

describe("pendingLibraryRows", () => {
  it("lists never-published rows and diverged published rows, and nothing else", () => {
    const sections: LibraryAdminSection[] = [
      section({
        items: [
          item("clean", "A", "A", true),
          item("diverged", "B edited", "B", true),
          item("fresh", "C", "", false),
        ],
      }),
    ];

    const pending = pendingLibraryRows(sections);
    expect(pending.map((r) => r.id).sort()).toEqual(["diverged", "fresh"]);
    expect(pending.find((r) => r.id === "diverged")).toMatchObject({
      hasChanges: true,
      isPublished: true,
    });
    expect(pending.find((r) => r.id === "fresh")).toMatchObject({
      hasChanges: false,
      isPublished: false,
    });
  });

  it("is empty when everything is published and clean", () => {
    // The queue must be able to reach zero, or it is a permanent alarm.
    expect(pendingLibraryRows([section({ items: [item("a", "A", "A", true)] })])).toEqual([]);
  });

  it("reaches items nested inside subsections", () => {
    const sections: LibraryAdminSection[] = [
      section({
        subsections: [
          {
            id: "sub1",
            section_id: "s1",
            is_published: true,
            content_version: 1,
            draft: names("Morning"),
            published: names("Morning"),
            items: [item("deep", "D edited", "D", true)],
          },
        ],
      }),
    ];
    const pending = pendingLibraryRows(sections);
    expect(pending.map((r) => r.id)).toEqual(["deep"]);
    // The breadcrumb is how a super_admin finds it in a tree of hundreds.
    expect(pending[0]!.where).toBe("Stavans / Morning");
  });

  it("reports an unpublished section itself, not only its contents", () => {
    const pending = pendingLibraryRows([section({ is_published: false })]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "section", name: "Stavans" });
  });
});
