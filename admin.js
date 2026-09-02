
const STORE_KEY='appletech_store';
const SESSION='appletech_admin_session';
function getStore(){
 let s=JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
 s.catalog=s.catalog||[];
 s.contact=s.contact||{};
 return s;
}
let store=getStore(),current='dashboard';
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(store));render();}
if(localStorage.getItem(SESSION)){loginView.hidden=true;panelView.hidden=false;}
function login(){if(u.value==='admin'&&p.value==='admin123'){localStorage.setItem(SESSION,'1');loginView.hidden=true;panelView.hidden=false;render();}else alert('Credenciales inválidas');}
function logout(){localStorage.removeItem(SESSION);location.reload();}
function showTab(t){current=t;render();}
function render(){
 const c=store.catalog;
 if(current==='dashboard'){
 tab.innerHTML=`<div class="result-card"><h2>Dashboard</h2>
 <p>Total: ${c.length}</p><p>Disponibles: ${c.filter(x=>x.estado==='disponible').length}</p>
 <p>Sin stock: ${c.filter(x=>x.estado==='sin_stock').length}</p>
 <p>Ocultos: ${c.filter(x=>x.estado==='oculto').length}</p></div>`;
 }
 if(current==='catalog'){
 tab.innerHTML=`<div class="result-card"><h2>Catálogo Plan Canje</h2>
 <input id="search" class="select-input" placeholder="Buscar" oninput="render()">
 <button class="btn btn-primary" onclick="addProduct()">Nuevo producto</button>
 ${c.map((m,i)=>`<div style="margin:10px 0;padding:10px;border:1px solid #444">
 <input value="${m.modelo||''}" onchange="store.catalog[${i}].modelo=this.value;save()">
 <input value="${m.capacidad||''}" onchange="store.catalog[${i}].capacidad=this.value;save()">
 <input value="${m.precio||0}" onchange="store.catalog[${i}].precio=+this.value;save()">
 <input value="${m.stock||0}" onchange="store.catalog[${i}].stock=+this.value;save()">
 <select onchange="store.catalog[${i}].estado=this.value;save()">
 ${['disponible','sin_stock','oculto','despublicado'].map(s=>`<option ${m.estado===s?'selected':''}>${s}</option>`).join('')}
 </select>
 <button onclick="dup(${i})">Duplicar</button><button onclick="delp(${i})">Eliminar</button></div>`).join('')}</div>`;
 }
 if(current==='contact'){
 let ct=store.contact;
 tab.innerHTML=`<div class="result-card"><h2>Contacto</h2>
 <input id="tel" class="select-input" placeholder="Teléfono" value="${ct.telefono||''}"><br><br>
 <input id="wa" class="select-input" placeholder="WhatsApp" value="${ct.whatsapp||''}"><br><br>
 <input id="ig" class="select-input" placeholder="Instagram" value="${ct.instagram||''}"><br><br>
 <input id="dir" class="select-input" placeholder="Dirección" value="${ct.direccion||''}"><br><br>
 <button class="btn btn-primary" onclick="saveContact()">Guardar</button></div>`;
 }
}
function addProduct(){store.catalog.push({id:Date.now(),modelo:'iPhone',capacidad:'128GB',precio:0,stock:0,estado:'despublicado'});save();}
function dup(i){store.catalog.push({...store.catalog[i],id:Date.now()});save();}
function delp(i){if(confirm('Eliminar?')){store.catalog.splice(i,1);save();}}
function saveContact(){store.contact={telefono:tel.value,whatsapp:wa.value,instagram:ig.value,direccion:dir.value};save();}
function exportData(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(store,null,2)]));a.download='backup.json';a.click();}
render();

// damage config
localStorage.setItem("appletech_damages",localStorage.getItem("appletech_damages")||JSON.stringify([]));
