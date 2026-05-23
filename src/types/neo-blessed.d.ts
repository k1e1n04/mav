declare module 'neo-blessed' {
  export * from 'blessed'
  declare const _default: typeof import('blessed')
  export { _default as default }
}
