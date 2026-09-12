import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { mml2omml } from 'mathml2omml';
import { DOMParser } from '@xmldom/xmldom';

// MathJax setup has real overhead (building the input jax + a MathDocument),
// so it's done once at module load and reused for every call, not rebuilt
// per equation. AllPackages is deliberately NOT used here — its
// 'bussproofs' package throws ("Cannot use 'in' operator ... 'getBBox'")
// when compiled outside a full HTML document context, which this
// document-less Node usage is. This trimmed set covers standard equation
// notation (fractions, roots, sums/integrals, Greek letters, bold/color)
// without pulling in proof-tree typesetting we'll never receive as input.
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: ['base', 'ams', 'noundefined', 'boldsymbol', 'color'] });
const visitor = new SerializedMmlVisitor();
const mathDocument = mathjax.document('', { InputJax: tex });

/**
 * Converts a LaTeX string to a real OOXML equation. Used as both the
 * conversion step AND the validation gate for equation recovery: if the
 * LaTeX doesn't compile, or mml2omml can't map the resulting MathML, this
 * throws — callers should treat that as "leave the original image alone"
 * rather than inserting something broken.
 *
 * Returns { ommlXmlString, ommlNode } — the node is already parsed and
 * ready to splice into a document.xml DOM (via @xmldom/xmldom), so callers
 * don't need to re-parse the string themselves.
 */
export function latexToOmml(latex) {
  const mmlNode = mathDocument.convert(latex, { display: true });
  const mathml = visitor.visitTree(mmlNode);
  const ommlXmlString = mml2omml(mathml);

  const ommlDoc = new DOMParser().parseFromString(ommlXmlString, 'text/xml');
  const ommlNode = ommlDoc.documentElement;
  if (!ommlNode || ommlNode.localName !== 'oMath') {
    throw new Error('mml2omml did not produce a valid <m:oMath> root element');
  }

  return { ommlXmlString, ommlNode };
}
