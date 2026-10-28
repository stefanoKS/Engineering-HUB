'use strict';
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {createDashboardDocument}=require('./dashboard-dom');
function harness(server,options={}){
 const {document,registry}=createDashboardDocument();
 function decorate(n){if(n.decorated)return n;n.decorated=true;const append=n.appendChild.bind(n);n.appendChild=child=>{if(n.text!==null){const text=create('span');text.textContent=n.text;n.text=null;append(text);}return append(child);};n.append=(...items)=>items.forEach(x=>n.appendChild(x));n.replaceChildren=(...items)=>{n.childNodes=[];n.text=null;n.append(...items);};n.showModal=()=>{n.open=true;};n.close=()=>{n.open=false;};n.classList={toggle:()=>true};return n;}
 const create=document.createElement;document.createElement=tag=>decorate(create(tag));
 const get=document.getElementById;document.getElementById=id=>decorate(get(id));document.documentElement=document.createElement('html');document.body=document.createElement('body');
 const store=new Map(),calls=[],waiting=[],events={};
 const window={confirm:()=>true,prompt:()=>'',addEventListener:(type,fn)=>{events[type]=fn;}};
 const google={script:{get run(){let success,failure;return{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},managerWebRead(op,p){call(false,op,p);},managerWebWrite(op,p){call(true,op,p);}};
 function call(write,operation,payload){const item={write,operation,payload,success,failure};calls.push(item);if(options.manual)waiting.push(item);else Promise.resolve().then(()=>success(server(write,operation,payload))).catch(failure);}}}};
 const context=vm.createContext({document,window,google,performance:{now:()=>Date.now()},Promise,Map,Set,console,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
 const root=path.resolve(__dirname,'../..');vm.runInContext(fs.readFileSync(path.join(root,'shared/i18n.js'),'utf8'),context);
 const client=options.clientSource||fs.readFileSync(path.join(root,'src/ManagerWebClient.html'),'utf8');
 vm.runInContext(client.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const nodes=id=>document.getElementById(id).descendants();
 const click=(id,text)=>{const b=nodes(id).find(n=>n.tagName==='BUTTON'&&n.textContent===text);if(!b)throw new Error('Button missing: '+text);b.dispatchEvent('click',{});};
 const fill=(name,value)=>{const n=nodes('formHost').find(n=>n.name===name);if(!n)throw new Error('Field missing: '+name);n.value=value;n.dispatchEvent('input',{});n.dispatchEvent('change',{});};
 const submit=()=>nodes('formHost').find(n=>n.tagName==='FORM').dispatchEvent('submit',{preventDefault(){}});
 return {document,registry,context,window,store,calls,waiting,events,nodes,click,fill,submit};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
module.exports={harness,flush};
