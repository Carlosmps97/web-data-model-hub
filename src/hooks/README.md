# src/hooks

Custom React hooks transversales (no pertenecen a una feature concreta).

## Cuándo vive un hook acá vs en una feature

- **Acá (`src/hooks/`)**: el hook es reutilizable por varias features o
  páginas, y su lógica no depende de un dominio específico.
  Ejemplos típicos: `useDebounce`, `useLocalStorage`, `useMediaQuery`,
  `useClickOutside`, `useKeyboardShortcut`.

- **Dentro de una feature (`src/features/<feature>/hooks/`)**: el hook
  encapsula lógica propia de ese dominio y sólo tiene sentido para esa
  feature (por ejemplo, un hook del canvas dentro de `src/features/modeler/`).

## Nomenclatura

Todos los archivos deben comenzar con `use` (convención React) y usar
`camelCase`: `useSomething.ts`.
