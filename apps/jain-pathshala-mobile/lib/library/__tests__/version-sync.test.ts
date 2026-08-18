import { describe, expect, it } from "vitest";
import type { LibrarySectionDto } from "@workspace/api-zod";
import type { LibraryTreePayload } from "@/lib/library/helpers";
import {
  clearItemTextInTree,
  planVersionSync,
  pruneTree,
  mergeSectionIntoTree,
} from "@/lib/library/version-sync";

const SECTION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_1 = "11111111-1111-4111-8111-111111111111";
const ITEM_2 = "22222222-2222-4222-8222-222222222222";

function sampleTree(): LibraryTreePayload {
  return {
    sections: [
      {
        id: SECTION_A,
        key: "a",
        name_en: "A",
        name_hi: null,
        name_gu: null,
        icon_url: null,
        order_index: 0,
        type: "item_list",
        deeplink_target: null,
        requires_login: false,
        is_published: true,
        content_version: 1,
        subsections: [
          {
            id: "ss-1",
            section_id: SECTION_A,
            name_en: "Sub",
            name_hi: null,
            name_gu: null,
            order_index: 0,
            content_version: 1,
            is_published: true,
            items: [
              {
                id: ITEM_1,
                section_id: SECTION_A,
                subsection_id: "ss-1",
                item_code: "i1",
                title_en: "One",
                title_hi: null,
                title_gu: null,
                order_index: 0,
                audio_url: "https://example.org/a.mp3",
                audio_size_bytes: 10,
                audio_duration_sec: null,
                youtube_url: null,
                text_content_en: "<p>hi</p>",
                text_content_hi: null,
                text_content_gu: null,
                tarj_en: null,
                tarj_hi: null,
                pdf_url: null,
                pdf_size_bytes: null,
                pdf_page_count: null,
                external_url: null,
                content_version: 1,
                is_published: true,
              },
            ],
          },
        ],
        items: [
          {
            id: ITEM_2,
            section_id: SECTION_A,
            subsection_id: null,
            item_code: "i2",
            title_en: "Two",
            title_hi: null,
            title_gu: null,
            order_index: 0,
            audio_url: null,
            audio_size_bytes: null,
            audio_duration_sec: null,
            youtube_url: null,
            text_content_en: "<p>two</p>",
            text_content_hi: null,
            text_content_gu: null,
            tarj_en: null,
            tarj_hi: null,
            pdf_url: null,
            pdf_size_bytes: null,
            pdf_page_count: null,
            external_url: null,
            content_version: 1,
            is_published: true,
          },
        ],
      },
      {
        id: SECTION_B,
        key: "b",
        name_en: "B",
        name_hi: null,
        name_gu: null,
        icon_url: null,
        order_index: 1,
        type: "panchang",
        deeplink_target: null,
        requires_login: false,
        is_published: true,
        content_version: 1,
        subsections: [],
        items: [],
      },
    ],
  };
}

describe("planVersionSync", () => {
  it("first run is baseline with no work", () => {
    const plan = planVersionSync({
      previous: null,
      server: {
        sections: { [SECTION_A]: 1 },
        items: { [ITEM_1]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      tree: sampleTree(),
      downloadedItemIds: [ITEM_1],
    });
    expect(plan.isBaseline).toBe(true);
    expect(plan.sectionsToRefetch).toEqual([]);
    expect(plan.downloadsToRefresh).toEqual([]);
  });

  it("prunes deleted sections and items", () => {
    const plan = planVersionSync({
      previous: {
        sections: { [SECTION_A]: 1, [SECTION_B]: 1 },
        items: { [ITEM_1]: 1, [ITEM_2]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      server: {
        sections: { [SECTION_A]: 1 },
        items: { [ITEM_1]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      tree: sampleTree(),
      downloadedItemIds: [ITEM_2],
    });
    expect(plan.removedSectionIds).toContain(SECTION_B);
    expect(plan.removedItemIds).toEqual(expect.arrayContaining([ITEM_2]));
  });

  it("marks item bumps for text clear, section refetch, and audio redownload", () => {
    const plan = planVersionSync({
      previous: {
        sections: { [SECTION_A]: 1, [SECTION_B]: 1 },
        items: { [ITEM_1]: 1, [ITEM_2]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      server: {
        sections: { [SECTION_A]: 1, [SECTION_B]: 1 },
        items: { [ITEM_1]: 2, [ITEM_2]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      tree: sampleTree(),
      downloadedItemIds: [ITEM_1],
    });
    expect(plan.staleItemIds).toContain(ITEM_1);
    expect(plan.sectionsToRefetch).toContain(SECTION_A);
    expect(plan.downloadsToRefresh).toContain(ITEM_1);
  });

  it("refetches when section version alone increases", () => {
    const plan = planVersionSync({
      previous: {
        sections: { [SECTION_A]: 1 },
        items: { [ITEM_1]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      server: {
        sections: { [SECTION_A]: 2 },
        items: { [ITEM_1]: 1 },
        granth_libraries: {},
        granth_entries: {},
      },
      tree: sampleTree(),
      downloadedItemIds: [],
    });
    expect(plan.sectionsToRefetch).toContain(SECTION_A);
    expect(plan.staleItemIds).toEqual([]);
  });
});

describe("tree mutators", () => {
  it("clears text on stale items", () => {
    const next = clearItemTextInTree(sampleTree(), new Set([ITEM_1]));
    const item = next.sections[0]!.subsections![0]!.items![0]!;
    expect(item.text_content_en).toBeNull();
  });

  it("prunes sections and items", () => {
    const next = pruneTree(sampleTree(), new Set([SECTION_B]), new Set([ITEM_2]));
    expect(next.sections.map((s) => s.id)).toEqual([SECTION_A]);
    expect(next.sections[0]!.items).toEqual([]);
  });

  it("merges a refreshed section", () => {
    const refreshed = {
      ...sampleTree().sections[0]!,
      content_version: 9,
    } satisfies LibrarySectionDto;
    const next = mergeSectionIntoTree(sampleTree(), refreshed);
    expect(next.sections[0]!.content_version).toBe(9);
  });
});
