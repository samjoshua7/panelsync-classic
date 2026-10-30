/* Admin-only draft state. No network calls, media copies or browser persistence. */
(function(root){
  function create(){
    let rows=[], patches=new Map(), originals=new Map();
    const copy=items=>items.map(item=>({...item}));
    const identity=item=>(item.disabled?'disabled_media':'media')+'/'+item.id;
    function ingest(items){rows=copy(items);}
    function edit(id,field,value){
      const item=rows.find(row=>row.id===id);if(!item)throw Error('Slide no longer exists. Discard and reload.');
      if(!['order','duration','disabled'].includes(field))throw Error('Unsupported draft field');
      if(field==='disabled' ? typeof value!=='boolean' : !Number.isInteger(value)||value<1||(field==='duration'&&value>600))throw Error('Duration must be a whole number from 1 to 600 seconds.');
      const key=id+'/'+field;
      if(!originals.has(key))originals.set(key,{value:field==='disabled'?!!item.disabled:item[field],node:identity(item)});
      if(value===originals.get(key).value){patches.delete(key);originals.delete(key);}else patches.set(key,{id,field,value});
    }
    function view(){return copy(rows).map(item=>{for(const patch of patches.values())if(patch.id===item.id)item[patch.field]=patch.value;return item;}).sort((a,b)=>(a.order||999)-(b.order||999));}
    function move(index,delta){const list=view(),other=index+delta;if(other<0||other>=list.length)return;[list[index],list[other]]=[list[other],list[index]];list.forEach((item,i)=>edit(item.id,'order',i+1));}
    function updates(dept,fresh){
      const values={},groups=new Map();
      for(const [key,patch]of patches){
        const item=fresh.find(row=>row.id===patch.id),before=originals.get(key);
        if(fresh.filter(row=>row.id===patch.id).length>1)throw Error('Slide exists in both active and archived lists. Resolve the duplicate before saving.');
        if(!item||identity(item)!==before.node)throw Error('A slide was removed or enabled/disabled while you edited. Discard and review the latest playlist.');
        const actual=patch.field==='disabled'?!!item.disabled:item[patch.field];
        if(actual!==before.value&&actual!==patch.value)throw Error('Another editor changed this playlist. Discard and review before saving.');
        if(!groups.has(item.id))groups.set(item.id,{item,fields:{}});
        groups.get(item.id).fields[patch.field]=patch.value;
      }
      for(const {item,fields}of groups.values()){
        const source='dept/'+dept+'/'+identity(item);
        if(Object.prototype.hasOwnProperty.call(fields,'disabled')&&fields.disabled!==!!item.disabled){
          const record={...item,...fields};delete record.id;
          if(!record.disabled)delete record.disabled;
          values[source]=null;
          values['dept/'+dept+'/'+(fields.disabled?'disabled_media':'media')+'/'+item.id]=record;
        }else for(const [field,value]of Object.entries(fields))if(field!=='disabled')values[source+'/'+field]=value;
      }
      return values;
    }
    function discard(){patches.clear();originals.clear();}
    return{ingest,edit,view,move,updates,discard,dirty:()=>patches.size>0,count:()=>patches.size,has:(id,field)=>patches.has(id+'/'+field)};
  }
  root.PanelPlaylistDraft={create};
})(window);
