import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export function RichText({ text }: { text?: string }): JSX.Element {
  return <div className="study-rich-text"><Markdown remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, strict: false }]]} skipHtml components={{ img: () => <span>[外部图片请查看原始资料]</span>, a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> }}>{text ?? ""}</Markdown></div>;
}
