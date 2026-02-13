var g={exports:{}},n={};/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var h=Symbol.for("react.element"),q=Symbol.for("react.portal"),F=Symbol.for("react.fragment"),U=Symbol.for("react.strict_mode"),z=Symbol.for("react.profiler"),H=Symbol.for("react.provider"),D=Symbol.for("react.context"),N=Symbol.for("react.forward_ref"),B=Symbol.for("react.suspense"),W=Symbol.for("react.memo"),K=Symbol.for("react.lazy"),x=Symbol.iterator;function Z(e){return e===null||typeof e!="object"?null:(e=x&&e[x]||e["@@iterator"],typeof e=="function"?e:null)}var R={isMounted:function(){return!1},enqueueForceUpdate:function(){},enqueueReplaceState:function(){},enqueueSetState:function(){}},j=Object.assign,A={};function p(e,t,r){this.props=e,this.context=t,this.refs=A,this.updater=r||R}p.prototype.isReactComponent={};p.prototype.setState=function(e,t){if(typeof e!="object"&&typeof e!="function"&&e!=null)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");this.updater.enqueueSetState(this,e,t,"setState")};p.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,"forceUpdate")};function O(){}O.prototype=p.prototype;function S(e,t,r){this.props=e,this.context=t,this.refs=A,this.updater=r||R}var w=S.prototype=new O;w.constructor=S;j(w,p.prototype);w.isPureReactComponent=!0;var b=Array.isArray,I=Object.prototype.hasOwnProperty,C={current:null},M={key:!0,ref:!0,__self:!0,__source:!0};function P(e,t,r){var o,u={},i=null,s=null;if(t!=null)for(o in t.ref!==void 0&&(s=t.ref),t.key!==void 0&&(i=""+t.key),t)I.call(t,o)&&!M.hasOwnProperty(o)&&(u[o]=t[o]);var l=arguments.length-2;if(l===1)u.children=r;else if(1<l){for(var c=Array(l),f=0;f<l;f++)c[f]=arguments[f+2];u.children=c}if(e&&e.defaultProps)for(o in l=e.defaultProps,l)u[o]===void 0&&(u[o]=l[o]);return{$$typeof:h,type:e,key:i,ref:s,props:u,_owner:C.current}}function G(e,t){return{$$typeof:h,type:e.type,key:t,ref:e.ref,props:e.props,_owner:e._owner}}function E(e){return typeof e=="object"&&e!==null&&e.$$typeof===h}function J(e){var t={"=":"=0",":":"=2"};return"$"+e.replace(/[=:]/g,function(r){return t[r]})}var $=/\/+/g;function k(e,t){return typeof e=="object"&&e!==null&&e.key!=null?J(""+e.key):t.toString(36)}function m(e,t,r,o,u){var i=typeof e;(i==="undefined"||i==="boolean")&&(e=null);var s=!1;if(e===null)s=!0;else switch(i){case"string":case"number":s=!0;break;case"object":switch(e.$$typeof){case h:case q:s=!0}}if(s)return s=e,u=u(s),e=o===""?"."+k(s,0):o,b(u)?(r="",e!=null&&(r=e.replace($,"$&/")+"/"),m(u,t,r,"",function(f){return f})):u!=null&&(E(u)&&(u=G(u,r+(!u.key||s&&s.key===u.key?"":(""+u.key).replace($,"$&/")+"/")+e)),t.push(u)),1;if(s=0,o=o===""?".":o+":",b(e))for(var l=0;l<e.length;l++){i=e[l];var c=o+k(i,l);s+=m(i,t,r,c,u)}else if(c=Z(e),typeof c=="function")for(e=c.call(e),l=0;!(i=e.next()).done;)i=i.value,c=o+k(i,l++),s+=m(i,t,r,c,u);else if(i==="object")throw t=String(e),Error("Objects are not valid as a React child (found: "+(t==="[object Object]"?"object with keys {"+Object.keys(e).join(", ")+"}":t)+"). If you meant to render a collection of children, use an array instead.");return s}function v(e,t,r){if(e==null)return e;var o=[],u=0;return m(e,o,"","",function(i){return t.call(r,i,u++)}),o}function Q(e){if(e._status===-1){var t=e._result;t=t(),t.then(function(r){(e._status===0||e._status===-1)&&(e._status=1,e._result=r)},function(r){(e._status===0||e._status===-1)&&(e._status=2,e._result=r)}),e._status===-1&&(e._status=0,e._result=t)}if(e._status===1)return e._result.default;throw e._result}var a={current:null},_={transition:null},X={ReactCurrentDispatcher:a,ReactCurrentBatchConfig:_,ReactCurrentOwner:C};function T(){throw Error("act(...) is not supported in production builds of React.")}n.Children={map:v,forEach:function(e,t,r){v(e,function(){t.apply(this,arguments)},r)},count:function(e){var t=0;return v(e,function(){t++}),t},toArray:function(e){return v(e,function(t){return t})||[]},only:function(e){if(!E(e))throw Error("React.Children.only expected to receive a single React element child.");return e}};n.Component=p;n.Fragment=F;n.Profiler=z;n.PureComponent=S;n.StrictMode=U;n.Suspense=B;n.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=X;n.act=T;n.cloneElement=function(e,t,r){if(e==null)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+e+".");var o=j({},e.props),u=e.key,i=e.ref,s=e._owner;if(t!=null){if(t.ref!==void 0&&(i=t.ref,s=C.current),t.key!==void 0&&(u=""+t.key),e.type&&e.type.defaultProps)var l=e.type.defaultProps;for(c in t)I.call(t,c)&&!M.hasOwnProperty(c)&&(o[c]=t[c]===void 0&&l!==void 0?l[c]:t[c])}var c=arguments.length-2;if(c===1)o.children=r;else if(1<c){l=Array(c);for(var f=0;f<c;f++)l[f]=arguments[f+2];o.children=l}return{$$typeof:h,type:e.type,key:u,ref:i,props:o,_owner:s}};n.createContext=function(e){return e={$$typeof:D,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null},e.Provider={$$typeof:H,_context:e},e.Consumer=e};n.createElement=P;n.createFactory=function(e){var t=P.bind(null,e);return t.type=e,t};n.createRef=function(){return{current:null}};n.forwardRef=function(e){return{$$typeof:N,render:e}};n.isValidElement=E;n.lazy=function(e){return{$$typeof:K,_payload:{_status:-1,_result:e},_init:Q}};n.memo=function(e,t){return{$$typeof:W,type:e,compare:t===void 0?null:t}};n.startTransition=function(e){var t=_.transition;_.transition={};try{e()}finally{_.transition=t}};n.unstable_act=T;n.useCallback=function(e,t){return a.current.useCallback(e,t)};n.useContext=function(e){return a.current.useContext(e)};n.useDebugValue=function(){};n.useDeferredValue=function(e){return a.current.useDeferredValue(e)};n.useEffect=function(e,t){return a.current.useEffect(e,t)};n.useId=function(){return a.current.useId()};n.useImperativeHandle=function(e,t,r){return a.current.useImperativeHandle(e,t,r)};n.useInsertionEffect=function(e,t){return a.current.useInsertionEffect(e,t)};n.useLayoutEffect=function(e,t){return a.current.useLayoutEffect(e,t)};n.useMemo=function(e,t){return a.current.useMemo(e,t)};n.useReducer=function(e,t,r){return a.current.useReducer(e,t,r)};n.useRef=function(e){return a.current.useRef(e)};n.useState=function(e){return a.current.useState(e)};n.useSyncExternalStore=function(e,t,r){return a.current.useSyncExternalStore(e,t,r)};n.useTransition=function(){return a.current.useTransition()};n.version="18.3.1";g.exports=n;var d=g.exports;/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),V=(...e)=>e.filter((t,r,o)=>!!t&&t.trim()!==""&&o.indexOf(t)===r).join(" ").trim();/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var ee={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const te=d.forwardRef(({color:e="currentColor",size:t=24,strokeWidth:r=2,absoluteStrokeWidth:o,className:u="",children:i,iconNode:s,...l},c)=>d.createElement("svg",{ref:c,...ee,width:t,height:t,stroke:e,strokeWidth:o?Number(r)*24/Number(t):r,className:V("lucide",u),...l},[...s.map(([f,L])=>d.createElement(f,L)),...Array.isArray(i)?i:[i]]));/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=(e,t)=>{const r=d.forwardRef(({className:o,...u},i)=>d.createElement(te,{ref:i,iconNode:t,className:V(`lucide-${Y(e)}`,o),...u}));return r.displayName=`${e}`,r};/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const re=y("Activity",[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",key:"169zse"}]]);/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ne=y("CircleAlert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]]);/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const oe=y("FileText",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]);/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ue=y("Settings",[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",key:"1qme2f"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ie=y("Shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]]);/**
 * @license lucide-react v0.460.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ce=y("TrendingUp",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]]);export{re as A,ne as C,oe as F,ie as S,ce as T,ue as a,d as r};
