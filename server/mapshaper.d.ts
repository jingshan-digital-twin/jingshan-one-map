declare module 'mapshaper' {
  const mapshaper:{applyCommands(command:string,input:Record<string,string>):Promise<Record<string,Uint8Array|string>>}
  export default mapshaper
}
