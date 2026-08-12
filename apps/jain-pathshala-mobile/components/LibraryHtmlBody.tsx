/**
 * Map sanitized library HTML (allowlist only) to React Native Text trees.
 */
import { Fragment, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

type Node =
  | { kind: "text"; value: string }
  | { kind: "br" }
  | { kind: "el"; tag: string; align: TextStyle["textAlign"] | null; children: Node[] };

const TOKEN_RE =
  /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g;

function parseAlign(attrs: string): TextStyle["textAlign"] | null {
  const m = attrs.match(/\bstyle\s*=\s*"([^"]*)"/i);
  if (!m) return null;
  const a = m[1]!.match(/text-align:\s*(left|center|right|justify)/i);
  return (a?.[1]?.toLowerCase() as TextStyle["textAlign"]) ?? null;
}

function parse(html: string): Node[] {
  type Frame = { tag: string; align: TextStyle["textAlign"] | null; children: Node[] };
  const root: Frame = { tag: "#root", align: null, children: [] };
  const stack: Frame[] = [root];

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(html)) !== null) {
    if (m[3] !== undefined) {
      stack[stack.length - 1]!.children.push({ kind: "text", value: decode(m[3]) });
      continue;
    }
    const tag = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const full = m[0];
    if (full.startsWith("</")) {
      if (stack.length > 1 && stack[stack.length - 1]!.tag === tag) {
        const frame = stack.pop()!;
        stack[stack.length - 1]!.children.push({
          kind: "el",
          tag: frame.tag,
          align: frame.align,
          children: frame.children,
        });
      }
      continue;
    }
    if (tag === "br" || /\/\s*>$/.test(full)) {
      stack[stack.length - 1]!.children.push({ kind: "br" });
      continue;
    }
    stack.push({
      tag,
      align: tag === "p" ? parseAlign(attrs) : null,
      children: [],
    });
  }
  while (stack.length > 1) {
    const frame = stack.pop()!;
    stack[stack.length - 1]!.children.push({
      kind: "el",
      tag: frame.tag,
      align: frame.align,
      children: frame.children,
    });
  }
  return root.children;
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function renderNodes(
  nodes: Node[],
  base: TextStyle,
  keyPrefix: string,
): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, i) => {
    const key = `${keyPrefix}${i}`;
    if (node.kind === "text") {
      out.push(
        <Text key={key} style={base}>
          {node.value}
        </Text>,
      );
      return;
    }
    if (node.kind === "br") {
      out.push(
        <Text key={key} style={base}>
          {"\n"}
        </Text>,
      );
      return;
    }
    const bold = node.tag === "b" || node.tag === "strong";
    const italic = node.tag === "i" || node.tag === "em";
    const style: TextStyle = {
      ...base,
      ...(bold ? { fontWeight: "700" as const } : null),
      ...(italic ? { fontStyle: "italic" as const } : null),
      ...(node.tag === "p" && node.align ? { textAlign: node.align } : null),
    };
    if (node.tag === "p") {
      out.push(
        <Text key={key} style={[style, { marginBottom: base.fontSize ? Number(base.fontSize) * 0.6 : 10 }]}>
          {renderNodes(node.children, style, `${key}.`)}
        </Text>,
      );
      return;
    }
    out.push(
      <Text key={key} style={style}>
        {renderNodes(node.children, style, `${key}.`)}
      </Text>,
    );
  });
  return out;
}

export function LibraryHtmlBody({
  html,
  style,
}: {
  html: string;
  style: StyleProp<TextStyle>;
}) {
  const flat = (Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style) as TextStyle;
  const nodes = parse(html);
  return <Fragment>{renderNodes(nodes, flat, "h")}</Fragment>;
}
