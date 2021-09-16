{
  // constants, classes, config and state
    const DEBUG = false;
    const DOUBLE_BARREL = /\w+-\w*/; // note that this matches triple- and higher barrels, too
    const F = _FUNC; 
    const FUNC_CALL = /\);?$/;
    const CONFIG = {
      htmlFile: 'markup.html',
      scriptFile: 'script.js',
      styleFile: 'style.css',
      bangKey: '_bang_key',
      componentsPath: './components',
      allowUnset: false,
      unsetPlaceholder: '',
      EVENTS: `error load click pointerdown pointerup pointermove mousedown mouseup 
        mousemove touchstart touchend touchmove touchcancel dblclick dragstart dragend 
        dragmove drag mouseover mouseout focus blur focusin focusout scroll
      `.split(/\s+/g).filter(s => s.length).map(e => `on${e}`),
      delayFirstPaintUntilLoaded: true,
      noHandlerPassthrough: false
    };
    const STATE = new Map();
    const CACHE = new Map();
    const Started = new Set();
    const TRANSFORMING = new WeakSet();
    const Dependents = new Map();
    const Counts = {
      started: 0,
      finished: 0
    };
    let systemKeys = 1;

    const BangBase = (name) => class Base extends HTMLElement {
      static #activeAttrs = ['state']; // we listen for changes to these attributes only

      static get observedAttributes() {
        return Array.from(Base.#activeAttrs);
      }

      #name = name;

      constructor() {
        super();
        DEBUG && console.log(name, 'constructed');
        this.print();
      }

      // BANG! API methods
      print() {
        Counts.started++;
        this.prepareVisibility();
        const state = this.#handleAttrs(this.attributes, {originals: true});
        this.#printShadow(state);
      }

      prepareVisibility() {
        this.classList.add('bang-el');
        this.classList.remove('bang-styled');
        // this is like an onerror event for stylesheet's 
          // we do this because we want to display elements if they have no stylesheet defined
          // becuase it's reasonabgle to want to not include a stylesheet with your custom element
        fetchStyle(name).catch(err => this.setVisible());
      }

      setVisible() {
        this.classList.add('bang-styled');
      }

      // Web Components methods
      attributeChangedCallback(name, oldValue, value) {
        // setting the state attribute casues the custom element to re-render
        if ( name === 'state' && !isUnset(oldValue) ) {
          DEBUG && console.log(`Changing state, so calling print.`, oldValue, value, this);
          this.print();
        }
      }

      connectedCallback() {
        DEBUG && console.log(name, 'connected');
      }

      // private methods
      #handleAttrs(attrs, {node, originals} = {}) {
        let state;

        if ( ! node ) node = this;

        for( let {name,value} of attrs ) {
          if ( isUnset(value) ) continue;

          if ( name === 'state' ) {
            const stateKey = value; 
            const stateObject = STATE.get(stateKey);
            
            if ( isUnset(stateObject) ) {
              throw new TypeError(`
                <${name}> constructor passed state key ${stateKey} which is unset. It must be set.
              `);
            }
            
            state = stateObject;
            
            if ( originals ) {
              let acquirers = Dependents.get(stateKey);
              if ( ! acquirers ) {
                acquirers = new Set();
                Dependents.set(stateKey, acquirers);
              }
              acquirers.add(node);
            }
          } else if ( originals ) { // set event handlers to custom element class instance methods
            if ( ! name.startsWith('on') ) continue;
            value = value.trim();
            if ( ! value ) continue;

            const path = node === this ? 'this.' : 'this.getRootNode().host.';
            if ( value.startsWith(path) ) continue;
            const ender = value.match(FUNC_CALL) ? '' : '(event)';
            node.setAttribute(name, `${path}${value}${ender}`);
          }
        }

        return state;
      }

      #printShadow(state) {
        fetchMarkup(this.#name, this).then(async markup => {
          const cooked = await cook.call(this, markup, state);
          const nodes = toDOM(cooked);
          // attributes on each node in the shadom DOM that has an even handler or state
          const listening = nodes.querySelectorAll(CONFIG.EVENTS.map(e => `[${e}]`).join(', '));
          listening.forEach(node => this.#handleAttrs(node.attributes, {node, originals: true}));
          DEBUG && console.log(nodes, cooked, state);
          const shadow = this.shadowRoot || this.attachShadow({mode:'open'});
          shadow.replaceChildren(nodes);
        })
        .catch(err => DEBUG && console.warn(err))
        .finally(() => Counts.finished++);
      }
    };

    class StateKey extends String {
      constructor (keyNumber) {
        if ( keyNumber == undefined ) super(`system-key:${systemKeys++}`); 
        else super(`client-key:${keyNumber}`);
      }
    }

  install();

  // API
    async function use(name) {
      let component;
      await fetchScript(name)
        .then(script => { // if there's a script that extends base, evaluate it to be component
          const Base = BangBase(name);
          const Compose = `(function () { ${Base.toString()}; return ${script}; }())`;
          try {
            component = eval(Compose);
          } catch(e) {
            DEBUG && console.warn(e, Compose, component)
          }
        }).catch(() => {  // otherwise if there is no such extension script, just use the Base class
          component = BangBase(name);
        });
      
      self.customElements.define(name, component);
      DEBUG && self.customElements.whenDefined(name).then(obj => console.log(name, 'defined', obj));
    }

    function bangfig(newConfig = {}) {
      Object.assign(CONFIG, newConfig);
    }

    function setState(key, state, rerenderAll = false) {
      STATE.set(key, state);
      STATE.set(state, key);

      if ( document.body && rerenderAll ) { // re-render all very simply
        // we need to remove styled because it will need to load after we set the innerHTML
        Array.from(document.querySelectorAll(':not(body).bang-styled'))
          .forEach(node => node.classList.remove('bang-styled'));
        
        const HTML = document.body.innerHTML;
        document.body.innerHTML = '';
        document.body.innerHTML = HTML;
      } else { // re-render only those components depending on that key
        const acquirers = Dependents.get(key);
        if ( acquirers ) acquirers.forEach(host => host.print());
      }
    }

    function cloneState(key) {
      if ( STATE.has(key) ) return JSON.parse(JSON.stringify(STATE.get(key)));
      else {
        throw new TypeError(`State store does not have the key ${key}`);
      }
    }

    async function loaded() {
      const loadCheck = () => {
        const nonZeroCount = Counts.started > 0; 
        const finishedWhatWeStarted = Counts.finished === Counts.started;
        return nonZeroCount && finishedWhatWeStarted;
      };
      return becomesTrue(loadCheck);
    }

  // helpers
    function install() {
      if ( CONFIG.delayFirstPaintUntilLoaded ) {
        becomesTrue(() => document.body).then(() => document.body.classList.add('bang-el'));
      }

      const observer = new MutationObserver(transformBangs);
      /* we are interested in bang nodes (which start as comments) */
      observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true}); 
      findBangs(transformBang); 
      Object.assign(globalThis, {
        use, setState, cloneState, loaded, sleep, bangfig,
        ...( DEBUG ? { STATE, CACHE, TRANSFORMING, Started, BangBase } : {})
      });
      
      loaded().then(() => document.body.classList.add('bang-styled'));
    }

    async function fetchMarkup(name, comp) {
      // cache first
        // we make any subsequent calls for name wait for the first call to complete
        // otherwise we create many in parallel without benefitting from caching

      const key = `markup:${name}`;

      if ( Started.has(key) ) {
        if ( ! CACHE.has(key) ) await becomesTrue(() => CACHE.has(key));
      } else Started.add(key);

      const styleKey = `style${name}`;
      const baseUrl = `${CONFIG.componentsPath}/${name}`;
      if ( CACHE.has(key) ) {
        const markup = CACHE.get(key);
        if ( CACHE.get(styleKey) instanceof Error ) comp.setVisible();
        
        // if there is an error style and we are still includig that link
        // we generate and cache the markup again to omit such a link element
        if ( CACHE.get(styleKey) instanceof Error && markup.includes(`href=${baseUrl}/${CONFIG.styleFile}`) ) {
          // then we need to set the cache for markup again and remove the link to the stylesheet which failed 
        } else {
          comp.setVisible();
          return markup;
        }
      }
      
      const markupUrl = `${baseUrl}/${CONFIG.htmlFile}`;
      let resp;
      const markupText = await fetch(markupUrl).then(async r => { 
        let text = '';
        if ( r.ok ) text = await r.text();
        else text = `<slot></slot>`;        // if no markup is given we just insert all content within the custom element
      
        if ( CACHE.get(styleKey) instanceof Error ) { 
          resp = text; 
          comp.setVisible();
        } else {
          // inlining styles for increase speed */
            // we setVisible (add bang-styled) straight away because the inline styles block the markup
            // so no FOUC while stylesheet link is loading, like previously: resp = `
            // <link rel=stylesheet href=${baseUrl}/${CONFIG.styleFile} onload=setVisible>${text}`;
          resp = `<style>${await fetchStyle(name).catch(e => '')}</style>${text}`;
          comp.setVisible();
        }
        
        return resp;
      }).finally(async () => CACHE.set(key, await resp));
      return markupText;
    }

    async function fetchFile(name, file) {
      const key = `${file}:${name}`;

      if ( Started.has(key) ) {
        if ( ! CACHE.has(key) ) await becomesTrue(() => CACHE.has(key));
      } else Started.add(key);

      if ( CACHE.has(key) ) return CACHE.get(key);

      const url = `${CONFIG.componentsPath}/${name}/${file}`;
      let resp;
      const fileText = await fetch(url).then(r => { 
        if ( r.ok ) {
          resp = r.text();
          return resp;
        } 
        resp = new TypeError(`Fetch error: ${url}, ${r.statusText}`);
        throw resp;
      }).finally(async () => CACHE.set(key, await resp));
      
      return fileText;
    }

    async function fetchStyle(name) {
      return fetchFile(name, CONFIG.styleFile);
    }

    async function fetchScript(name) {
      return fetchFile(name, CONFIG.scriptFile);
    }

    // search and transform each added subtree
    function transformBangs(records) {
      records.forEach(record => {
        DEBUG && console.log(record);
        const {addedNodes} = record;
        if ( !addedNodes ) return;
        addedNodes.forEach(node => findBangs(transformBang, node));
      });
    }

    function transformBang(current) {
      DEBUG && console.log({transformBang},{current});
      const [name, data] = getBangDetails(current);
      DEBUG && console.log({name, data});

      // replace the bang node (comment) with its actual custom element node
      const actualElement = createElement(name, data);
      current.parentElement.replaceChild(actualElement, current);
    }

    function findBangs(callback, root = document.documentElement) {
      const Acceptor = {
        acceptNode(node) {
          if ( node.nodeType !== Node.COMMENT_NODE ) return NodeFilter.FILTER_SKIP;
          const [name] = getBangDetails(node); 
          if ( name.match(DOUBLE_BARREL) ) return NodeFilter.FILTER_ACCEPT;
          else return NodeFilter.FILTER_REJECT;
        }
      };
      const iterator = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, Acceptor);
      const replacements = [];

      // handle root node
        // it's a special case because it will be present in the iteration even if
        // the NodeFilter would filter it out if it were not the root
      let current = iterator.currentNode;

      if ( Acceptor.acceptNode(current) === NodeFilter.FILTER_ACCEPT ) {
        if ( !TRANSFORMING.has(current) ) {
          TRANSFORMING.add(current);
          const target = current;
          replacements.push(() => transformBang(target));
        }
      }

      // handle any descendents
        while (true) {
          current = iterator.nextNode();
          if ( ! current ) break;

          if ( !TRANSFORMING.has(current) ) {
            TRANSFORMING.add(current);
            const target = current;
            replacements.push(() => transformBang(target));
          }
        }

      while(replacements.length) replacements.pop()();
    }

    function getBangDetails(node) {
      const text = node.textContent.trim();
      const [name, ...data] = text.split(/[\s\t]/g);
      return [name, data.join(' ')];
    }

    async function process(x, state) {
      if ( typeof x === 'string' ) return x;
      else 

      if ( typeof x === 'number' ) return x+'';
      else

      if ( typeof x === 'boolean' ) return x+'';
      else

      if ( x instanceof Date ) return x+'';
      else

      if ( isUnset(x) ) {
        if ( CONFIG.allowUnset ) return CONFIG.unsetPlaceholder || '';
        else {
          throw new TypeError(`Value cannot be unset, was: ${x}`);
        }
      }
      else

      if ( x instanceof Promise ) return await x.catch(err => err+'');
      else

      if ( x instanceof Element ) return x.outerHTML;
      else

      if ( x instanceof Node ) return x.textContent;
      else

      if ( isIterable(x) ) {
        // if an Array or iterable is given then
        // its values are recursively processed via this same function
        return (await Promise.all(
          (
            await Promise.all(Array.from(x)).catch(e => err+'')
          ).map(v => process(v, state))
        )).join('\n');
      }
      else

      if ( Object.getPrototypeOf(x).constructor.name === 'AsyncFunction' ) return await x(state);
      else

      if ( x instanceof Function ) return x(state);
      else // it's an object, of some type 

      {
        // State store     
          /* so we assume an object is state and save it */
          /* to the global state store */
          /* which is two-sides so we can find a key */
          /* given an object. This avoid duplicates */
        let stateKey;

        // own keys
          // an object can specify it's own state key
          // to provide a single logical identity for a piece of state that may
          // be represented by many objects

        if ( Object.prototype.hasOwnProperty.call(x, CONFIG.bangKey) ) {
          stateKey = new StateKey(x[CONFIG.bangKey])+'';
          // in that case, replace the previously saved object with the same logical identity
          const oldX = STATE.get(stateKey);
          STATE.delete(oldX);

          STATE.set(stateKey, x);
          STATE.set(x, stateKey);
        } 

        else  /* or the system can come up with a state key */

        {
          if ( STATE.has(x) ) stateKey = STATE.get(x);
          else {
            stateKey = new StateKey()+'';
            STATE.set(stateKey, x);
            STATE.set(x, stateKey);
          }
        }

        stateKey += '';
        DEBUG && console.log({stateKey});
        return stateKey;
      }
    }

    async function cook(markup, state) {
      let cooked = '';
      try {
        if ( !Object.prototype.hasOwnProperty.call(state, '_self') ) {
          Object.defineProperty(state, '_self', {
            get: () => state
          });
        }
        DEBUG && console.log('self', state._self);
      } catch(e) {
        DEBUG && console.warn(
          `Cannot add '_self' self-reference property to state. 
            This enables a component to inspect the top-level state object it is passed.`
        );
      }
      try {
        with(state) {
          cooked = await eval("(async function () { return await _FUNC`${{state}}"+markup+"`; }())");  
        }
        return cooked;
      } catch(error) {
        console.error('Template error', {markup, state, error});
        throw error;
      }
    }

    async function _FUNC(strings, ...vals) {
      const s = Array.from(strings);
      DEBUG && console.log(s.join('//'));
      let SystemCall = false;
      let str = '';

      if ( s[0].length === 0 && vals[0].state ) {
        // by convention (see how we construct the template that we tag with FUNC)
        // the first value is the state object when our system calls it
        SystemCall = true;
      }

      let state;

      // resolve all the values now if it's a SystemCall of _FUNC
      
      if ( SystemCall ) {
        const state = vals.shift();
        s.shift();
        vals = await Promise.all(vals.map(v => process(v, state)));
        DEBUG && console.log('System _FUNC call: ' + vals.join('::'));

        while(s.length) {
          str += s.shift();
          if ( vals.length ) {
            str += vals.shift();
          }
        }
        return str;
      } 

      else 

      // otherwise resolve them when we have access to the top-level state
        // this is effectively just a little bit of magic that lets us "overload"
        // the method signature of F

      return async state => {
        vals = await Promise.all(vals.map(v => process(v, state)));
        DEBUG && console.log('in-template _FUNC call:' + vals.join('::'));

        while(s.length) {
          str += s.shift();
          if ( vals.length ) str += vals.shift();
        }
        return str;
      };
    }

    function createElement(name, data) {
      const df = document.createDocumentFragment();
      const container = document.createElement('div');
      df.appendChild(container);
      container.insertAdjacentHTML(`afterbegin`, `<${name} ${data}></${name}>`);
      return container.firstElementChild;
    }

    function toDOM(str) {
      const f = (new DOMParser).parseFromString(`<template>${str}</template>`,"text/html")
        .head.firstElementChild.content;
      f.normalize();
      return f;
    }

    async function becomesTrue(check = () => true) {
      const waiter = new Promise(async res => {
        while(true) {
          await sleep(47);
          if ( check() ) break;
        }
        res();
      });

      return waiter;
    }

    async function sleep(ms) {
      return new Promise(res => setTimeout(res, ms));
    }

    function isIterable(y) {
      if ( y === null ) return false;
      return y[Symbol.iterator] instanceof Function;
    }

    function isUnset(x) {
      return x === undefined || x === null;
    }
}
