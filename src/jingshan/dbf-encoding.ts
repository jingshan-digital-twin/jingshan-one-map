export type DbfEncoding = 'auto' | 'utf-8' | 'gb18030' | 'big5'

// DBF byte 29 is the dBASE language-driver ID, not a Windows code page number.
const languageDrivers:Record<number,string> = {
  0x03:'windows-1252', 0x13:'shift_jis', 0x26:'ibm866',
  0x4d:'gbk', 0x4e:'euc-kr', 0x4f:'big5', 0x50:'windows-874',
  0x57:'windows-1252', 0x58:'windows-1252', 0x59:'windows-1252', 0x65:'ibm866',
  0x78:'big5', 0x79:'euc-kr', 0x7a:'gbk', 0x7b:'shift_jis', 0x7c:'windows-874',
  0xc8:'windows-1250', 0xc9:'windows-1251', 0xca:'windows-1254', 0xcb:'windows-1253', 0xcc:'windows-1257',
}
const codePages:Record<string,string> = {
  '936':'gbk', '54936':'gb18030', '950':'big5', '65001':'utf-8',
  '932':'shift_jis', '949':'euc-kr', '874':'windows-874', '866':'ibm866',
}

function cpgEncoding(bytes:Uint8Array):string | undefined {
  const utf16=bytes[0]===0xff && bytes[1]===0xfe ? 'utf-16le' : bytes[0]===0xfe && bytes[1]===0xff ? 'utf-16be' : 'utf-8'
  const label=new TextDecoder(utf16).decode(bytes).replaceAll('\0','').trim().replace(/^["']|["']$/g,'').trim()
  if (!label) return
  const compact=label.replace(/[\s_-]/g,'').toLowerCase()
  const code=/^(?:ansi|windows|cp|ms|oem)?(\d+)$/.exec(compact)?.[1]
  const name=code ? codePages[code] ?? ('windows-'+code) : ({
    utf8:'utf-8',gb18030:'gb18030',gb2312:'gbk',gbk:'gbk',big5:'big5',big5hkscs:'big5',
  } as Record<string,string>)[compact] ?? label
  try { return new TextDecoder(name).encoding }
  catch { throw Error('CPG 声明的字符编码「'+label+'」无法识别，请在导入时选择属性编码。') }
}

// Read only DBF names and character columns. Header metadata, deletion flags and
// binary numeric fields can contain arbitrary bytes even in a UTF-8 table.
function hasUtf8Text(dbf:Uint8Array) {
  if (dbf.length<33) throw Error('DBF 属性表头不完整')
  const view=new DataView(dbf.buffer,dbf.byteOffset,dbf.byteLength)
  const rows=view.getUint32(4,true), start=view.getUint16(8,true), width=view.getUint16(10,true)
  if (start<33 || !width || start+rows*width>dbf.length) throw Error('DBF 属性表的记录长度与文件不符')
  const decoder=new TextDecoder('utf-8',{fatal:true})
  const valid=(at:number,len:number)=>{
    for (let i=at;i<at+len;i++) if (dbf[i]>=128) {
      try { decoder.decode(dbf.subarray(at,at+len)); return true } catch { return false }
    }
    return true
  }
  const fields:{offset:number;size:number}[]=[]
  let offset=1
  for(let i=32;i<start && dbf[i]!==0x0d;i+=32){
    if (i+32>start) throw Error('DBF 字段描述不完整')
    const size=dbf[i+16], type=dbf[i+11]
    if (!valid(i,11)) return false
    if (type===0x43 || type===0x56) fields.push({offset,size}) // C / V
    offset+=size
  }
  if (offset>width) throw Error('DBF 字段长度超出记录范围')
  for(let row=0;row<rows;row++){
    const at=start+row*width
    for (const field of fields) if (!valid(at+field.offset,field.size)) return false
  }
  return true
}

export function resolveDbfEncoding(dbf:Uint8Array, cpg:Uint8Array | undefined, selection:DbfEncoding):string {
  const encoding=selection==='auto' ? (cpg && cpgEncoding(cpg)) ?? languageDrivers[dbf[29]] : selection
  if (encoding && encoding!=='utf-8') return encoding
  if (hasUtf8Text(dbf)) return 'utf-8'
  if (encoding==='utf-8') {
    const source=selection==='auto' ? 'CPG 文件声明了 UTF-8 编码' : '当前选择了 UTF-8 编码'
    throw Error(source+'，但部分 DBF 属性无法按 UTF-8 读取。请选择简体中文（GB18030）或繁体中文（Big5），并核对属性预览。')
  }
  return 'gb18030'
}
