// Resolution hook used by css-stub.mjs: any .css specifier resolves to an empty JS module. This lets the
// gallery React tree (which transitively imports the design-system .css) be imported under Node for the
// axe audit. No em dashes.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".css")) {
    return { url: "data:text/javascript,export default {}", shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
