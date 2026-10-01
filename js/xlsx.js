/* MyMon — writing a real spreadsheet.

   A .csv file has no columns. It has commas, and every program decides for
   itself whether those are column breaks or part of the text — which is why
   the same file opens as a neat table on one machine and as one long column
   on the next. An .xlsx file has columns, in writing, and nothing has to
   guess: it also carries its own column widths, a heading row that stays put
   while you scroll, and amounts that are numbers rather than text.

   An .xlsx is a zip holding a handful of XML files. Both halves are written
   here rather than pulled in as a library: a writer that only ever has to put
   out one plain table is a page of code, where the libraries that do
   everything are hundreds of kilobytes. */
window.MyMon = window.MyMon || {};

(function (NS) {
  'use strict';

  /* ---------- the zip half ------------------------------------------------ */

  var CRC = (function () {
    var table = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(text) { return new TextEncoder().encode(text); }

  /* A growable list of bytes, with the little-endian writes a zip is made of. */
  function buffer() {
    var out = [];
    return {
      bytes: function (list) { for (var i = 0; i < list.length; i++) out.push(list[i]); },
      u16: function (v) { out.push(v & 0xFF, (v >>> 8) & 0xFF); },
      u32: function (v) {
        out.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
      },
      at: function () { return out.length; },
      done: function () { return new Uint8Array(out); }
    };
  }

  /* A zip keeps the clock in the shape MS-DOS used in 1980: two bytes each,
     and seconds only to the nearest two. */
  function dosStamp() {
    var now = new Date();
    return {
      time: (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1),
      date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
    };
  }

  /* Stored, never compressed. These parts are a few kilobytes of XML, and not
     compressing them costs a little size and saves carrying a deflate. */
  function zip(parts) {
    var stamp = dosStamp();
    var body = buffer();
    var index = [];

    parts.forEach(function (part) {
      var name = utf8(part.name);
      var data = utf8(part.text);
      var entry = { name: name, data: data, crc: crc32(data), offset: body.at() };
      index.push(entry);

      body.u32(0x04034b50);
      body.u16(20);              /* the version needed to open it */
      body.u16(0x0800);          /* the names are UTF-8 */
      body.u16(0);               /* stored */
      body.u16(stamp.time);
      body.u16(stamp.date);
      body.u32(entry.crc);
      body.u32(data.length);
      body.u32(data.length);
      body.u16(name.length);
      body.u16(0);               /* no extra field */
      body.bytes(name);
      body.bytes(data);
    });

    /* The central directory: the same entries again, which is how a reader
       finds them without walking the whole file. */
    var start = body.at();
    index.forEach(function (entry) {
      body.u32(0x02014b50);
      body.u16(20);
      body.u16(20);
      body.u16(0x0800);
      body.u16(0);
      body.u16(stamp.time);
      body.u16(stamp.date);
      body.u32(entry.crc);
      body.u32(entry.data.length);
      body.u32(entry.data.length);
      body.u16(entry.name.length);
      body.u16(0);               /* extra */
      body.u16(0);               /* comment */
      body.u16(0);               /* disk */
      body.u16(0);               /* internal attributes */
      body.u32(0);               /* external attributes */
      body.u32(entry.offset);
      body.bytes(entry.name);
    });

    var size = body.at() - start;
    body.u32(0x06054b50);
    body.u16(0);
    body.u16(0);
    body.u16(index.length);
    body.u16(index.length);
    body.u32(size);
    body.u32(start);
    body.u16(0);                 /* no comment */

    return body.done();
  }

  /* ---------- the spreadsheet half ---------------------------------------- */

  /* XML forbids most control characters outright, so a stray one is dropped
     rather than written into a file that then refuses to open. Tab, newline
     and carriage return are the three it allows. */
  function xml(value) {
    var text = String(value == null ? '' : value);
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
      var ch = text.charAt(i);
      if (ch === '&') out += '&amp;';
      else if (ch === '<') out += '&lt;';
      else if (ch === '>') out += '&gt;';
      else out += ch;
    }
    return out;
  }

  /* 0, 1, 2 ... -> A, B, C ... Z, AA. Five columns never reach AA, but the
     function has no reason to know that. */
  function columnName(i) {
    var name = '';
    var n = i + 1;
    while (n > 0) {
      var rest = (n - 1) % 26;
      name = String.fromCharCode(65 + rest) + name;
      n = (n - 1 - rest) / 26;
    }
    return name;
  }

  /* A spreadsheet counts days from the 30th of December 1899 — one day before
     you would expect, because its calendar keeps a 29th of February 1900 that
     never happened, and everything since has had to agree with it. */
  var EPOCH = Date.UTC(1899, 11, 30);

  function serialDate(key) {
    var at = Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
    return Math.round((at - EPOCH) / 86400000);
  }

  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  var PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  var DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  /* Style 1 is the heading, 2 a date, 3 money. The first two fills have to be
     "none" and "gray125" whether or not anything uses them — a spreadsheet
     refuses the file otherwise. */
  function styles() {
    return HEAD +
      '<styleSheet xmlns="' + MAIN + '">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>' +
      '<fonts count="2">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid">' +
          '<fgColor rgb="FF3D8A45"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"' +
          ' applyFont="1" applyFill="1" applyAlignment="1">' +
          '<alignment vertical="center"/></xf>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function sheetXml(sheet) {
    var columns = sheet.columns;
    var span = 'A1:' + columnName(columns.length - 1) + (sheet.rows.length + 1);

    var cols = '<cols>' + columns.map(function (column, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
        column.width + '" customWidth="1"/>';
    }).join('') + '</cols>';

    var head = '<row r="1" ht="22" customHeight="1">' + columns.map(function (column, i) {
      return '<c r="' + columnName(i) + '1" s="1" t="inlineStr"><is><t>' +
        xml(column.title) + '</t></is></c>';
    }).join('') + '</row>';

    var body = sheet.rows.map(function (row, r) {
      var n = r + 2;
      return '<row r="' + n + '">' + row.map(function (cell, i) {
        var at = columnName(i) + n;
        var type = columns[i].type;

        if (type === 'date') return '<c r="' + at + '" s="2"><v>' + serialDate(cell) + '</v></c>';
        if (type === 'number') return '<c r="' + at + '" s="3"><v>' + (Number(cell) || 0) + '</v></c>';
        if (cell === '' || cell == null) return '';

        /* Written into the cell rather than into a shared table of strings:
           one part fewer, and notes do not repeat enough to be worth it. */
        return '<c r="' + at + '" t="inlineStr"><is><t xml:space="preserve">' +
          xml(cell) + '</t></is></c>';
      }).join('') + '</row>';
    }).join('');

    return HEAD +
      '<worksheet xmlns="' + MAIN + '">' +
      '<dimension ref="' + span + '"/>' +
      '<sheetViews><sheetView workbookViewId="0">' +
        /* The headings stay in place while the rows scroll under them. */
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      '<sheetData>' + head + body + '</sheetData>' +
      /* The little arrows on each heading, for sorting and filtering. */
      '<autoFilter ref="' + span + '"/>' +
      '</worksheet>';
  }

  /* sheet: { name, columns: [{ title, type, width }], rows: [[cell, ...]] },
     where type is 'date' (a YYYY-MM-DD string), 'number' or 'text'.
     Returns the bytes of an .xlsx file. */
  function book(sheet) {
    return zip([
      { name: '[Content_Types].xml', text: HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>' },

      { name: '_rels/.rels', text: HEAD +
        '<Relationships xmlns="' + PKG + '">' +
        '<Relationship Id="rId1" Type="' + DOC + '/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },

      { name: 'xl/workbook.xml', text: HEAD +
        '<workbook xmlns="' + MAIN + '" xmlns:r="' + DOC + '">' +
        '<sheets><sheet name="' + xml(sheet.name) + '" sheetId="1" r:id="rId1"/></sheets>' +
        '</workbook>' },

      { name: 'xl/_rels/workbook.xml.rels', text: HEAD +
        '<Relationships xmlns="' + PKG + '">' +
        '<Relationship Id="rId1" Type="' + DOC + '/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="' + DOC + '/styles" Target="styles.xml"/>' +
        '</Relationships>' },

      { name: 'xl/styles.xml', text: styles() },
      { name: 'xl/worksheets/sheet1.xml', text: sheetXml(sheet) }
    ]);
  }

  NS.xlsx = { book: book, columnName: columnName, serialDate: serialDate };
})(window.MyMon);
