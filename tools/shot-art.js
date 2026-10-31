const path=require('path'), puppeteer=require('puppeteer-core');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
(async()=>{
  const b=await puppeteer.launch({executablePath:EDGE,headless:'new',args:['--allow-file-access-from-files','--hide-scrollbars']});
  const p=await b.newPage();
  await p.setViewport({width:960,height:1000,deviceScaleFactor:2});
  await p.goto('file:///'+path.resolve(__dirname,'art-preview.html').replace(/\\/g,'/'),{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,500));
  await p.screenshot({path:path.join(__dirname,'..','_shots','ram-art-preview.png'),captureBeyondViewport:false});
  console.log('ok'); await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
