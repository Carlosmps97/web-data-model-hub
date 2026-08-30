// Carga masiva desde Excel (doc 55): popup + servicio + parseo del workbook.
export { default as UploadModal } from './components/UploadModal';
export { parseWorkbook } from './lib/parseWorkbook';
export type { ParsedWorkbook, UploadWorkbookBody } from './lib/parseWorkbook';
export * from './upload.service';
