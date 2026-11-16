import ExcelJS from 'exceljs';

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF14202E' } };
const FONT = 'Vazirmatn';

// Builds an RTL workbook from simple sheet descriptions:
// { name, title?, columns: [{ key, label, width?, type?: 'number'|'percent'|'text' }], rows: [...] }
export async function buildWorkbook(sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vazifeh';
  workbook.created = new Date();

  sheets.forEach((sheet) => {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), { views: [{ rightToLeft: true, state: 'frozen', ySplit: sheet.title ? 2 : 1 }] });
    let headerRowIndex = 1;
    if (sheet.title) {
      ws.mergeCells(1, 1, 1, sheet.columns.length);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = sheet.title;
      titleCell.font = { name: FONT, bold: true, size: 13 };
      titleCell.alignment = { horizontal: 'right' };
      headerRowIndex = 2;
    }
    const header = ws.getRow(headerRowIndex);
    sheet.columns.forEach((col, index) => {
      const cell = header.getCell(index + 1);
      cell.value = col.label;
      cell.font = { name: FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getColumn(index + 1).width = col.width || 16;
    });
    header.height = 24;

    sheet.rows.forEach((row) => {
      const values = sheet.columns.map((col) => {
        const value = row[col.key];
        if (col.type === 'percent' && typeof value === 'number') return value / 100;
        return value ?? '';
      });
      const added = ws.addRow(values);
      added.font = { name: FONT };
      added.alignment = { vertical: 'top', wrapText: true };
      sheet.columns.forEach((col, index) => {
        const cell = added.getCell(index + 1);
        if (col.type === 'number') cell.numFmt = '#,##0.##';
        if (col.type === 'percent') cell.numFmt = '0.0%';
      });
    });
    ws.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: sheet.columns.length } };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function sendWorkbook(res, buffer, fileName) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(buffer);
}
