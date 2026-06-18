// Allow importing .css side-effect files from components so a single component import pulls its styles.
// Consumers bundle with Vite, which resolves these; tsc treats them as empty modules. No em dashes.
declare module "*.css";
