const r=Object.freeze({PAGE_CONTEXT:"PAGE_CONTEXT",PAGE_CONTEXT_UPDATED:"PAGE_CONTEXT_UPDATED",REQUEST_PAGE_CONTEXT:"REQUEST_PAGE_CONTEXT",OVERLAY_READY:"OVERLAY_READY",OVERLAY_STATUS:"OVERLAY_STATUS",SET_OVERLAY_SIDE:"SET_OVERLAY_SIDE",CLOSE_OVERLAY:"CLOSE_OVERLAY"});function n(e){if(!e||typeof e!="object")return!1;const t=e;return typeof t.title=="string"&&typeof t.url=="string"&&typeof t.text=="string"&&Number.isInteger(t.originalChars)&&Number.isInteger(t.retainedChars)&&typeof t.truncated=="boolean"}function E(e){return String(e??"").replace(/\r\n?/g,`
`).replace(/[\t\f\v ]+\n/g,`
`).replace(/\n[\t\f\v ]+/g,`
`).replace(/[\t\f\v ]{2,}/g," ").replace(/\n{3,}/g,`

`).trim()}function o(e){try{const t=new URL(String(e??""));return t.protocol==="http:"||t.protocol==="https:"?t.href:""}catch{return""}}export{r as W,n as i,E as n,o as s};
