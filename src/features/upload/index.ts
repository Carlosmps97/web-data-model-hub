// Carga masiva desde Excel: popup + perfiles + servicio + lectura cruda del workbook.
export { default as UploadModal } from './components/UploadModal';
export { default as ProfileManagerModal } from './components/ProfileManagerModal';
export { readWorkbook, findSheet, headersAt, sheetRowCount } from './lib/parseWorkbook';
export type { RawWorkbook } from './lib/parseWorkbook';
export * from './upload.service';
