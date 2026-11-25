declare module "react" {
  const React: any;
  export = React;
}

declare module "react-dom/client" {
  export function createRoot(container: Element | DocumentFragment): {
    render(node: any): void;
    unmount(): void;
  };
}
