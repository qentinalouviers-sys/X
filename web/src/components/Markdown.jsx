import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import CodeBlock from './CodeBlock.jsx';

const COMPONENTS = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};

/**
 * Mid-stream the text routinely ends inside an open ``` fence, which makes
 * the parser swallow the rest of the document. Close it virtually.
 */
function balanceFences(text) {
  const fences = (text.match(/^```/gm) || []).length;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function Markdown({ children, streaming = false }) {
  const source = useMemo(
    () => (streaming ? balanceFences(children || '') : children || ''),
    [children, streaming]
  );
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={COMPONENTS}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);
