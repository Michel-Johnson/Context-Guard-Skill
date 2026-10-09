// Ephemeral display cache: no localStorage, Map edits, conversation or credentials.
export function createMapTranslations({request,onUpdate=()=>{}}){
  const cache=new Map(),failed=new Set();let current='',running=false,queued=null,state='idle';
  const scopeKey=({scope,language})=>JSON.stringify([scope,language]);
  const key=(text,options)=>JSON.stringify([scopeKey(options),text]);
  const setState=value=>{state=value;onUpdate();};
  async function run(){
    if(running||!queued)return;
    const job=queued;queued=null;running=true;
    const token=scopeKey(job.options);
    const missing=job.texts.filter(text=>!cache.has(key(text,job.options))&&!failed.has(key(text,job.options)));
    try{
      if(!missing.length){if(token===current&&state==='loading')setState('idle');return;}
      if(token===current)setState('loading');
      while(missing.length){
        const batch=[];let size=0;
        while(missing.length&&batch.length<24&&size+missing[0].length<=6000){const text=missing.shift();batch.push(text);size+=text.length;}
        const result=await request({language:job.options.language,texts:batch},job.options);
        if(result?.language!==job.options.language||!Array.isArray(result.translations)||result.translations.length!==batch.length)throw Error('Invalid translations');
        const seen=new Set();
        for(const row of result.translations){if(!batch.includes(row.source)||seen.has(row.source)||typeof row.text!=='string'||!row.text.trim()||row.text.length>4000)throw Error('Invalid translation');seen.add(row.source);}
        for(const row of result.translations){cache.set(key(row.source,job.options),row.text);while(cache.size>2048)cache.delete(cache.keys().next().value);}
        if(token===current)onUpdate();
      }
      if(token===current)setState('idle');
    }catch{
      for(const text of job.texts)if(!cache.has(key(text,job.options))){failed.add(key(text,job.options));while(failed.size>2048)failed.delete(failed.values().next().value);}
      if(token===current)setState('error');
    }finally{running=false;if(queued)void run();}
  }
  return {
    read:(text,options)=>cache.get(key(text,options))||text,
    status:()=>state,
    ensure(texts,options){
      const token=scopeKey(options);if(token!==current){current=token;state='idle';onUpdate();}
      if(options.language!=='en'){queued=null;return;}
      const valid=[...new Set(texts.filter(text=>typeof text==='string'&&text.trim()&&text.length<=2000))];
      if(!valid.some(text=>!cache.has(key(text,options))&&!failed.has(key(text,options))))return;
      queued={texts:valid,options:{...options}};void run();
    },
    retry(texts,options){for(const text of texts)failed.delete(key(text,options));this.ensure(texts,options);},
  };
}
