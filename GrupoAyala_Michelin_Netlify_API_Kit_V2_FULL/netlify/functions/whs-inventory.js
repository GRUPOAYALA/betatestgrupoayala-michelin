
function detectDelimiter(h){return h.split(";").length>h.split(",").length?";":","}
function parseCsv(t){
 const l=t.replace(/\r/g,"").split("\n").filter(x=>x.trim());
 if(l.length<2) return [];
 const d=detectDelimiter(l[0]);
 const h=l[0].split(d).map(x=>x.trim().toUpperCase());
 const iA=h.indexOf("ALMACEN"), iS=h.indexOf("SHIPTO"), iM=h.indexOf("ARTICULO"), iD=h.indexOf("DISPONIBLE");
 if(iA<0||iM<0||iD<0) throw new Error("CSV inválido. Se requieren columnas: ALMACEN, ARTICULO, DISPONIBLE (SHIPTO opcional).");
 return l.slice(1).map(r=>{
  const c=r.split(d);
  return {
    warehouse:(c[iA]||"").trim(),
    shipTo:(iS>=0?(c[iS]||"").trim():""),
    mspn:(c[iM]||"").trim(),
    available:parseFloat((c[iD]||"0").toString().replace(/,/g,"."))||0
  }
 }).filter(x=>x.warehouse&&x.mspn);
}

exports.handler = async (event)=>{
 try{
  const q=event.queryStringParameters||{};
  const wh=(q.warehouse||"").trim(), m=(q.mspn||"").trim();
  const o=`${event.headers["x-forwarded-proto"]}://${event.headers["host"]}`;
  const r=await fetch(`${o}/inventarios.csv?ts=${Date.now()}`, { headers: { "cache-control":"no-store" } });
  if(!r.ok) return {statusCode:502,headers:{ "content-type":"application/json" },body:JSON.stringify({error:"CSV not reachable"})};
  let items=parseCsv(await r.text());
  if(wh) items=items.filter(x=>x.warehouse===wh);
  if(m) items=items.filter(x=>x.mspn===m);

  const n=new Date();
  const d=n.toISOString().slice(0,10), t=n.toTimeString().slice(0,8);

  const lineLevel=items.map(x=>({
    lineId:String(x.mspn),
    article:{
      articleIdentification:{
        manufacturersArticleID:String(x.mspn),
        eanuccArticleID:String(x.mspn)
      },
      articleDescription:{ articleDescriptionText:String(x.mspn) },
      scheduleDetails:{ availableQuantity:{ quantityValue:Math.round(x.available) } }
    }
  }));

  return {
    statusCode:items.length?200:404,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "access-control-allow-origin":"*"
    },
    body:JSON.stringify({
      issueDate:d, issueTime:t,
      documentID:"C1",
      documentNumber:String(Date.now()),
      variant:"0",
      errorHeader:{ errorCode:"0" },
      totalLineItemNumber:String(lineLevel.length),
      contract:{ documentID:"00001" },
      lineLevel
    },null,2)
  };
 }catch(e){
  return {statusCode:500,headers:{ "content-type":"application/json" },body:JSON.stringify({error:e.message})};
 }
};
