(function(root){
  const posterKey='panelsync-video-posters-v1';let posters={};
  try{posters=JSON.parse(localStorage.getItem(posterKey)||'{}');}catch{}
  function poster(url){const value=posters[url];return typeof value==='string'&&/^data:image\/jpeg;base64,/.test(value)?value:null;}
  function capture(video,url){
    if(!url||video.readyState<2||!video.videoWidth)return;
    try{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#141827';ctx.fillRect(0,0,320,180);const scale=Math.min(320/video.videoWidth,180/video.videoHeight);ctx.drawImage(video,(320-video.videoWidth*scale)/2,(180-video.videoHeight*scale)/2,video.videoWidth*scale,video.videoHeight*scale);const data=canvas.toDataURL('image/jpeg',.65);if(data.length>60000)return;delete posters[url];posters[url]=data;const keys=Object.keys(posters);while(keys.length>12)delete posters[keys.shift()];try{localStorage.setItem(posterKey,JSON.stringify(posters));}catch{}document.querySelectorAll('[data-poster-url]').forEach(el=>{if(el.dataset.posterUrl===url){const img=document.createElement('img');img.src=data;img.alt='Video frame';el.replaceChildren(img);}});}catch{/* Cross-origin or undecodable frames keep the descriptive fallback. */}
  }
  function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  root.PanelVideoPosters={get:poster,capture,escape};
  function mount(access){
    const aside=document.querySelector('main>aside'), section=document.querySelector('main>section');
    const flow=document.querySelector('[data-backend-details]');
    if(flow)aside.append(flow);
    if(flow){const actions=document.createElement('div');actions.className='system-actions';document.querySelectorAll('.nav-brand button').forEach(button=>actions.append(button));flow.append(actions);}
    const cards=Array.from(aside.querySelectorAll(':scope>.card'));
    const names=['Upload','Settings','Text slide','Background','Music','System'];
    const switcher=document.createElement('button');switcher.className='department-switch';switcher.type='button';
    switcher.textContent=(new URLSearchParams(location.search).get('dept')||'Department').toUpperCase()+'　⌄';
    switcher.onclick=()=>{const overlay=document.getElementById('deptModalOverlay'),grid=document.getElementById('deptGrid');grid.replaceChildren();Object.keys(access.roles).forEach(dept=>{const b=document.createElement('button');b.className='primary-btn';b.textContent=dept.toUpperCase();b.onclick=()=>location.assign('?dept='+encodeURIComponent(dept));grid.append(b);});overlay.style.display='flex';};
    const tabs=document.createElement('div');tabs.className='sidebar-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Dashboard controls');
    cards.forEach((card,index)=>{const button=document.createElement('button');button.type='button';button.textContent=names[index]||'More';button.setAttribute('role','tab');button.onclick=()=>{cards.forEach((c,i)=>{c.hidden=i!==index;tabs.children[i].setAttribute('aria-selected',String(i===index));});};tabs.append(button);});
    aside.prepend(tabs);aside.prepend(switcher);if(tabs.firstChild)tabs.firstChild.click();
    const heading=document.createElement('header');heading.className='workspace-heading';const title=document.createElement('div');title.innerHTML='<h1>Your display, curated.</h1><p>Preview, arrange and publish. All your slides in one place.</p>';heading.append(title);section.prepend(heading);
    const usage=document.getElementById('b2StorageUsage');if(usage&&flow)flow.append(usage);
  }
  root.PanelDashboard={mount};
})(window);
