import "server-only";
import sanitizeHtml from "sanitize-html";

const tags = ["p","br","b","i","u","em","strong","sup","sub","span","div","ul","ol","li","table","thead","tbody","tr","th","td","img","math","mi","mn","mo","mrow","mfrac","msup","msub","msubsup","msqrt","mroot","mtext","mspace","mover","munder","munderover","mtable","mtr","mtd","mfenced","mstyle","semantics","annotation"];
export function sanitizeRichText(input: string | null | undefined): string | null {
  if (input == null) return null;
  const output = sanitizeHtml(input, { allowedTags: tags, allowedAttributes: { math: ["xmlns","display"], img: ["src","alt","width","height"] }, allowedSchemes: ["http","https"], disallowedTagsMode: "discard" });
  return output.trim() ? output : null;
}
export function toPlainText(input: string | null | undefined): string { return (input ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim(); }
