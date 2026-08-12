/**
 * Read-only course outline for Guruji browse (no student progress).
 * Tap section → subsection list; tap subsection → description sheet.
 */
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useLocale } from "@/contexts/LocaleContext";
import { bodyFamily } from "@/constants/typography";
import { Body, Button, StateView, Title } from "@/components/ui";
import { useAdminCourseTree } from "@/lib/queries";

type ContentTarget = {
  title_en: string;
  title_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
};

export function CourseBrowseOutline(props: {
  courseId: string;
  onMarkForStudent?: () => void;
}) {
  const c = useColors();
  const { hi } = useLocale();
  const treeQ = useAdminCourseTree(props.courseId);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [content, setContent] = useState<ContentTarget | null>(null);

  if (treeQ.isLoading) {
    return <StateView status="loading" emptyText="" />;
  }
  if (treeQ.isError || !treeQ.data) {
    return (
      <StateView
        status="error"
        emptyText=""
        errorText={
          hi
            ? "पाठ्यक्रम नहीं खुल सका — रीफ़्रेश करें।"
            : "Could not load this course — pull to refresh."
        }
        onRetry={() => void treeQ.refetch()}
        retryLabel={hi ? "फिर कोशिश करें" : "Try again"}
      />
    );
  }

  const tree = treeQ.data;
  const courseTitle = hi
    ? tree.course.name_hi || tree.course.name_en
    : tree.course.name_en;

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Text
          style={{
            fontSize: 18,
            lineHeight: 26,
            fontFamily: bodyFamily(hi, "semibold"),
            color: c.secondary,
          }}
        >
          {courseTitle}
        </Text>
        {tree.course.academic_year ? (
          <Body muted style={{ lineHeight: 22 }}>
            {tree.course.academic_year}
          </Body>
        ) : null}
        <Body muted style={{ lineHeight: 22, fontSize: 13 }}>
          {hi
            ? "संरचना और सामग्री देखें — प्रगति के लिए विद्यार्थी चुनें।"
            : "Browse structure and content — pick a student for Progress."}
        </Body>
      </View>

      {props.onMarkForStudent ? (
        <Button
          label={hi ? "विद्यार्थी के लिए प्रगति…" : "Progress for a student…"}
          onPress={props.onMarkForStudent}
        />
      ) : null}

      <View
        style={{
          backgroundColor: c.card,
          borderRadius: c.radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          overflow: "hidden",
        }}
      >
        {tree.sections.length === 0 ? (
          <StateView
            status="empty"
            emptyText={
              hi ? "इस पाठ्यक्रम में अभी कोई अनुभाग नहीं।" : "No sections in this course yet."
            }
          />
        ) : (
          tree.sections.map((section, i) => {
            const title = hi ? section.title_hi || section.title_en : section.title_en;
            const expanded = openSectionId === section.id;
            return (
              <View key={section.id}>
                <Pressable
                  onPress={() =>
                    setOpenSectionId((cur) => (cur === section.id ? null : section.id))
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: c.border,
                    backgroundColor: expanded ? c.muted : c.card,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      lineHeight: 20,
                      fontFamily: bodyFamily(hi, "semibold"),
                      color: c.foreground,
                      minWidth: 22,
                    }}
                  >
                    {i + 1}.
                  </Text>
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 14,
                      lineHeight: 20,
                      fontFamily: bodyFamily(hi),
                      color: c.foreground,
                    }}
                    numberOfLines={2}
                  >
                    {title}
                  </Text>
                  {section.subsections.length > 0 ? (
                    <Body muted style={{ fontSize: 12, lineHeight: 18 }}>
                      ({section.subsections.length})
                    </Body>
                  ) : null}
                  <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={c.mutedForeground}
                  />
                </Pressable>
                {expanded
                  ? section.subsections.map((sub, j) => {
                      const subTitle = hi
                        ? sub.title_hi || sub.title_en
                        : sub.title_en;
                      return (
                        <Pressable
                          key={sub.id}
                          onPress={() =>
                            setContent({
                              title_en: sub.title_en,
                              title_hi: sub.title_hi,
                              description_en: sub.description_en,
                              description_hi: sub.description_hi,
                            })
                          }
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            paddingVertical: 11,
                            paddingLeft: 36,
                            paddingRight: 14,
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: c.border,
                            backgroundColor: c.background,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              lineHeight: 18,
                              fontFamily: bodyFamily(hi),
                              color: c.mutedForeground,
                              minWidth: 28,
                            }}
                          >
                            {i + 1}.{j + 1}
                          </Text>
                          <Text
                            style={{
                              flex: 1,
                              fontSize: 14,
                              lineHeight: 20,
                              fontFamily: bodyFamily(hi),
                              color: c.foreground,
                            }}
                            numberOfLines={2}
                          >
                            {subTitle}
                          </Text>
                          <Ionicons
                            name="document-text-outline"
                            size={16}
                            color={c.mutedForeground}
                          />
                        </Pressable>
                      );
                    })
                  : null}
              </View>
            );
          })
        )}
      </View>

      <Modal
        visible={!!content}
        transparent
        animationType="slide"
        onRequestClose={() => setContent(null)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: c.foreground + "73" }]}
          onPress={() => setContent(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={[
              styles.sheet,
              {
                backgroundColor: c.card,
                borderColor: c.border,
                borderRadius: c.radius,
              },
            ]}
          >
            <Title style={{ fontSize: 18, lineHeight: 26 }}>
              {content
                ? hi
                  ? content.title_hi || content.title_en
                  : content.title_en
                : ""}
            </Title>
            <Text
              style={{
                marginTop: 12,
                fontSize: 15,
                lineHeight: 24,
                color: c.foreground,
                fontFamily: bodyFamily(hi),
              }}
            >
              {(() => {
                if (!content) return "";
                const body = hi
                  ? content.description_hi || content.description_en
                  : content.description_en || content.description_hi;
                return (
                  body ||
                  (hi
                    ? "इस उप-अनुभाग के लिए अभी कोई सामग्री नहीं जोड़ी गई।"
                    : "No content has been added for this subsection yet.")
                );
              })()}
            </Text>
            <View style={{ marginTop: 18 }}>
              <Button
                variant="outline"
                label={hi ? "बंद करें" : "Close"}
                onPress={() => setContent(null)}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    padding: 20,
    borderWidth: 1,
    maxHeight: "80%",
  },
});
