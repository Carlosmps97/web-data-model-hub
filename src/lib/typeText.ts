// Doc 92 D6 — texto de un tipo de dato en UNA sola línea. Los tipos complejos
// que Erwin trae (`Array\n<\n\tstruct <\n\tcol: varchar(30),…`) llegan con
// saltos de línea y tabulaciones; en un CREATE TABLE eso parte la definición
// de la columna en varias líneas. Se pliegan a un espacio y se colapsan los
// espacios repetidos; casing y espacios simples quedan VERBATIM (F4 #6).
export function foldComplexType(dataType: string): string {
  return (dataType ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}
