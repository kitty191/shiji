/* Standalone preview only. Messages are accepted only from this page's own frame. */
(() => {
  const frame = document.getElementById('codex-visualization');
  if (!frame) return;
  const defaults = {page:'buyer',query:'',category:'全部',sort:'default',priceMin:'',priceMax:'',listPage:1,storeName:'好物生活馆',storeQuery:'',storeCategory:'全部',storeSort:'default',storeMin:'',storeMax:'',storePage:1,detailId:'lamp',detailSku:'white-usb',photo:0,browsePage:'buyer',browseAnchor:'',orderId:'',orderBack:'orders',orderFilter:'全部',paymentId:'',merchantTab:'overview',merchantQuery:'',merchantStatus:'全部',adminTab:'applications',adminQuery:'',adminStatus:'全部',adminSince:'',adminSelected:''};
  const pages = new Set(['buyer','store','detail','cart','orders','order-detail','addresses','checkout','payment','payment-result','messages','profile','opening','apply','progress','workspace','admin','login','publish']);
  let ready = false, index = 0, currentHash = '', currentRoute = {...defaults};
  let request = 0, pending = null, suppressPop = false, deferredScroll = null;
  let viewportFrame = 0, viewportKey = '';
  history.scrollRestoration = 'manual';

  function clean(route) {
    const result = {...defaults};
    for (const key of Object.keys(defaults)) {
      if (typeof route?.[key] === 'string' || typeof route?.[key] === 'number') result[key] = String(route[key]).slice(0,80);
    }
    if (!pages.has(result.page)) result.page = 'buyer';
    return result;
  }
  function hashFor(value) {
    const route = clean(value), params = new URLSearchParams();
    const keys = new Set();
    if (['buyer','detail','store'].includes(route.page)) ['query','category','sort','priceMin','priceMax','listPage'].forEach(k=>keys.add(k));
    if (route.page==='store' || (route.page==='detail' && route.browsePage==='store')) ['storeName','storeQuery','storeCategory','storeSort','storeMin','storeMax','storePage'].forEach(k=>keys.add(k));
    if (route.page==='detail') ['detailId','detailSku','photo','browsePage','browseAnchor'].forEach(k=>keys.add(k));
    if (route.page==='orders') keys.add('orderFilter');
    if (route.page==='order-detail') ['orderId','orderBack','orderFilter'].forEach(k=>keys.add(k));
    if (route.page==='workspace' || route.page==='publish' || (route.page==='order-detail' && route.orderBack==='workspace')) ['merchantTab','merchantQuery','merchantStatus'].forEach(k=>keys.add(k));
    if (route.page==='admin' || (route.page==='order-detail' && route.orderBack==='admin')) ['adminTab','adminQuery','adminStatus','adminSince','adminSelected'].forEach(k=>keys.add(k));
    if (['payment','payment-result'].includes(route.page)) keys.add('paymentId');
    for (const key of keys) if (String(route[key]) !== String(defaults[key])) params.set(key,route[key]);
    return '#/' + route.page + (params.size ? '?' + params.toString() : '');
  }
  function fromHash() {
    const match = location.hash.match(/^#\/([a-z-]+)(?:\?(.*))?$/);
    if (!match || !pages.has(match[1])) return null;
    return clean({...Object.fromEntries(new URLSearchParams(match[2] || '')),page:match[1]});
  }
  function postRoute(route, reason, targetIndex = index, scroll = 0) {
    pending = {id:++request, route, reason, targetIndex, scroll, delta:targetIndex-index};
    frame.contentWindow?.postMessage({type:'tlg:route',route,requestId:request},'*');
  }
  function restoreScroll(top) {
    deferredScroll = {top:Math.max(0,Number(top)||0),until:Date.now()+1500};
    requestAnimationFrame(() => requestAnimationFrame(applyScroll));
  }
  function applyScroll() {
    if (!deferredScroll) return;
    const {top,until} = deferredScroll;
    window.scrollTo({top,behavior:'instant'});
    if (Math.abs(window.scrollY-top)<2 || Date.now()>until) deferredScroll = null;
  }
  function scheduleViewport() {
    if (viewportFrame) return;
    viewportFrame = requestAnimationFrame(() => {
      viewportFrame = 0;
      const rect = frame.getBoundingClientRect(), height = window.innerHeight;
      const top = Math.max(0,-rect.top), bottom = Math.max(top,Math.min(rect.height,height-rect.top));
      const data = {type:'tlg:viewport',top,bottom,height,scrollTop:window.scrollY};
      const key = JSON.stringify(data);
      if (key !== viewportKey) { viewportKey = key; frame.contentWindow?.postMessage(data,'*'); }
    });
  }
  new MutationObserver(() => { if (deferredScroll) applyScroll(); scheduleViewport(); }).observe(frame,{attributes:true,attributeFilter:['style']});
  function saveScroll() {
    if (!ready || pending || suppressPop || deferredScroll || location.hash !== currentHash) return;
    history.replaceState({...history.state,tlgIndex:index,tlgScroll:window.scrollY},'',currentHash);
  }
  window.addEventListener('scroll',() => { saveScroll(); scheduleViewport(); },{passive:true});
  window.addEventListener('resize',scheduleViewport);
  frame.addEventListener('load',() => { viewportKey = ''; scheduleViewport(); });
  window.addEventListener('message',event => {
    if (event.source !== frame.contentWindow || !event.data || typeof event.data !== 'object') return;
    const data = event.data;
    if (data.type === 'tlg:viewport-request') {
      viewportKey = ''; scheduleViewport(); return;
    }
    if (data.type === 'tlg:scroll-top') {
      deferredScroll = null;
      window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      return;
    }
    if (data.type === 'tlg:ready') {
      ready = true;
      index = Number.isInteger(history.state?.tlgIndex) ? history.state.tlgIndex : 0;
      const route = fromHash() || clean(data.route);
      currentRoute = clean(data.route);
      currentHash = hashFor(route);
      history.replaceState({...history.state,tlgIndex:index,tlgScroll:history.state?.tlgScroll||0},'',currentHash);
      postRoute(route,'initial',index,history.state?.tlgScroll||0);
      viewportKey = ''; scheduleViewport();
    } else if (data.type === 'tlg:navigate' && ready && !pending) {
      const route = clean(data.route), hash = hashFor(route);
      if (hash === currentHash) return;
      saveScroll();
      const samePage = route.page === currentRoute.page && (route.page !== 'detail' || route.detailId === currentRoute.detailId) && (route.page !== 'store' || route.storeName === currentRoute.storeName);
      const top = samePage ? window.scrollY : 0;
      const minor = samePage && ['detail','order-detail','payment','payment-result'].includes(route.page);
      if (!minor) index++;
      history[minor?'replaceState':'pushState']({tlgIndex:index,tlgScroll:top},'',hash);
      currentHash = hash; currentRoute = route;
      if (!samePage) restoreScroll(0);
    } else if (data.type === 'tlg:accepted' && pending?.id === data.requestId) {
      const p = pending; pending = null;
      currentRoute = clean(data.route); currentHash = hashFor(currentRoute); index = p.targetIndex;
      history.replaceState({tlgIndex:index,tlgScroll:p.scroll},'',currentHash);
      restoreScroll(p.scroll);
    } else if (data.type === 'tlg:rejected' && pending?.id === data.requestId) {
      const p = pending; pending = null;
      if (p.delta) { suppressPop = true; history.go(-p.delta); }
      else history.replaceState({tlgIndex:index,tlgScroll:window.scrollY},'',currentHash);
    }
  });
  function historyChanged() {
    if (!ready) return;
    if (suppressPop) { suppressPop = false; return; }
    if (location.hash === currentHash || pending) return;
    const target = fromHash() || defaults;
    const targetIndex = Number.isInteger(history.state?.tlgIndex) ? history.state.tlgIndex : index;
    postRoute(target,'history',targetIndex,history.state?.tlgScroll||0);
  }
  window.addEventListener('popstate',historyChanged);
  window.addEventListener('hashchange',historyChanged);
  scheduleViewport();
})();
