// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

exports.create = editBoxCreate; // eslint-disable-line @typescript-eslint/no-use-before-define

const assert = require('assert');
const { trimEnd } = require('glov/common/util.js');
const verify = require('glov/common/verify.js');
const camera2d = require('./camera2d.js');
const engine = require('./engine.js');
const {
  KEYS,
  eatAllKeyboardInput,
  mouseConsumeClicks,
  keyDownEdge,
  keyUpEdge,
  pointerLockEnter,
  pointerLockExit,
  pointerLocked,
  inputClick,
} = require('./input.js');
const { getStringIfLocalizable } = require('./localization.js');
const {
  spotFocusCheck,
  spotFocusSteal,
  spotUnfocus,
  spotlog,
  spotSuppressKBNav,
} = require('./spot.js');
const glov_ui = require('./ui.js');
const {
  getUIElemData,
  uiGetDOMElem,
  uiTextHeight,
} = require('./ui.js');

let form_hook_registered = false;
let active_edit_box;
let active_edit_box_frame;

let this_frame_edit_boxes = [];
let last_frame_edit_boxes = [];

export function editBoxTick() {
  let expected_last_frame = engine.frame_index - 1;
  for (let ii = 0; ii < last_frame_edit_boxes.length; ++ii) {
    let edit_box = last_frame_edit_boxes[ii];
    if (edit_box.last_frame < expected_last_frame) {
      edit_box.unrun();
    }
  }
  last_frame_edit_boxes = this_frame_edit_boxes;
  this_frame_edit_boxes = [];
}

function setActive(edit_box) {
  active_edit_box = edit_box;
  active_edit_box_frame = engine.frame_index;
}

export function editBoxAnyActive() {
  return active_edit_box && active_edit_box_frame >= engine.frame_index - 1;
}

function formHook(ev) {
  ev.preventDefault();

  if (!editBoxAnyActive()) {
    return;
  }
  active_edit_box.submitted = true;
  active_edit_box.updateText();
  if (active_edit_box.pointer_lock && !active_edit_box.text) {
    pointerLockEnter('edit_box_submit');
  }
}

let last_key_id = 0;

class GlovUIEditBox {
  constructor(params) {
    this.key = `eb${++last_key_id}`;
    this.x = 0;
    this.y = 0;
    this.z = Z.UI; // actually in DOM, so above everything!
    this.w = glov_ui.button_width;
    this.type = 'text';
    // this.h = glov_ui.button_height;
    this.font_height = uiTextHeight();
    this.text = '';
    this.placeholder = '';
    this.max_len = 0;
    this.zindex = null;
    this.uppercase = false;
    this.initial_focus = false;
    this.onetime_focus = false;
    this.auto_unfocus = false;
    this.focus_steal = false;
    this.initial_select = false;
    this.spellcheck = true;
    this.esc_clears = true;
    this.esc_unfocuses = true;
    this.multiline = 0;
    this.suppress_up_down = false;
    this.autocomplete = false;
    this.sticky_focus = true;
    this.applyParams(params);
    assert.equal(typeof this.text, 'string');

    this.last_autocomplete = null;
    this.is_focused = false;
    this.elem = null;
    this.input = null;
    this.submitted = false;
    this.pointer_lock = false;
    this.last_frame = 0;
    this.out = {}; // Used by spotFocusCheck
    this.last_valid_state = {
      // text: '', just use this.text!
      sel_start: 0,
      sel_end: 0,
    };
  }
  applyParams(params) {
    if (!params) {
      return;
    }
    for (let f in params) {
      this[f] = params[f];
    }
    if (this.text === undefined) {
      // do not trigger assert if `params` has a `text: undefined` member
      this.text = '';
    }
    this.h = this.font_height;
  }
  updateText() {
    const { input } = this;
    let new_text = input.value;
    if (new_text === this.text) {
      this.last_valid_state.sel_start = input.selectionStart;
      this.last_valid_state.sel_end = input.selectionEnd;
      return;
    }
    const { multiline, max_len } = this;
    // text has changed, validate
    let valid = true;

    if (multiline && new_text.split('\n').length > multiline) {
      // If trimming would help, trim the text, and update, preserving current selection
      // Otherwise, will revert to last good state
      // does trimming help?
      if (trimEnd(new_text).split('\n').length <= multiline) {
        while (new_text.split('\n').length > multiline) {
          if (new_text[new_text.length-1].match(/\s/)) {
            new_text = new_text.slice(0, -1);
          }
        }
        let sel_start = input.selectionStart;
        let sel_end = input.selectionEnd;
        input.value = new_text;
        input.selectionStart = sel_start;
        input.selectionEnd = sel_end;
      } else {
        valid = false;
      }
    }

    if (max_len > 0) {
      let lines = multiline ? new_text.split('\n') : [new_text];
      for (let ii = 0; ii < lines.length; ++ii) {
        let line = lines[ii];
        if (line.length > max_len) {
          if (trimEnd(line).length <= max_len) {
            let old_line_end_pos = lines.slice(0, ii+1).join('\n').length;
            lines[ii] = trimEnd(line);
            let new_line_end_pos = lines.slice(0, ii+1).join('\n').length;
            new_text = lines.join('\n');
            let sel_start = input.selectionStart;
            let sel_end = input.selectionEnd;
            let shift = old_line_end_pos - new_line_end_pos;
            if (sel_start > old_line_end_pos) {
              sel_start -= shift;
            } else if (sel_start > new_line_end_pos) {
              sel_start = new_line_end_pos;
            }
            if (sel_end >= old_line_end_pos) {
              sel_end -= shift;
            } else if (sel_end > new_line_end_pos) {
              sel_end = new_line_end_pos;
            }
            input.value = new_text;
            input.selectionStart = sel_start;
            input.selectionEnd = sel_end;
          } else {
            valid = false;
          }
        }
      }
    }
    if (!valid) {
      // revert!
      input.value = this.text;
      input.selectionStart = this.last_valid_state.sel_start;
      input.selectionEnd = this.last_valid_state.sel_end;
    } else {
      this.text = new_text;
      this.last_valid_state.sel_start = input.selectionStart;
      this.last_valid_state.sel_end = input.selectionEnd;
    }
  }
  getText() {
    return this.text;
  }
  setText(new_text) {
    new_text = String(new_text);
    if (this.input && this.input.value !== new_text) {
      this.input.value = new_text;
    }
    this.text = new_text;
  }
  focus() {
    if (this.input) {
      this.input.focus();
      setActive(this);
    } else {
      this.onetime_focus = true;
    }
    spotFocusSteal(this);
    this.is_focused = true;
    if (this.pointer_lock && pointerLocked()) {
      pointerLockExit();
    }
  }
  unfocus() {
    spotUnfocus();
  }
  isFocused() { // call after .run()
    return this.is_focused;
  }

  updateFocus(is_reset) {
    let was_glov_focused = this.is_focused;
    let spot_ret = spotFocusCheck(this);
    let { focused } = spot_ret;
    let dom_focused = this.input && document.activeElement === this.input;
    if (was_glov_focused !== focused) {
      // something external (from clicks/keys in GLOV) changed, apply it if it doesn't match
      if (focused && !dom_focused && this.input) {
        spotlog('GLOV focused, DOM not, focusing', this);
        this.input.focus();
      }
      if (!focused && dom_focused) {
        spotlog('DOM focused, GLOV not, and changed, blurring', this);
        this.input.blur();
      }
    } else if (dom_focused && !focused) {
      spotlog('DOM focused, GLOV not, stealing', this);
      spotFocusSteal(this);
      focused = true;
    } else if (!dom_focused && focused) {
      if (is_reset) {
        // Just appeared this frame, steal DOM focus
        this.onetime_focus = true;
        spotlog('GLOV focused, DOM not, new edit box, focusing', this);
      } else if (document.activeElement === engine.canvas || document.activeElement === this.postspan) {
        // focus explicitly on canvas or left our input element, lose focus
        spotlog('GLOV focused, DOM canvas focused, unfocusing', this);
        spotUnfocus();
      } else {
        // Leave it alone, it may be a browser pop-up such as for passwords
      }
    }

    if (focused) {
      setActive(this);
      let key_opt = (this.pointer_lock && !this.text) ? { in_event_cb: pointerLockEnter } : null;
      if ((this.esc_clears || this.esc_unfocuses) && keyUpEdge(KEYS.ESC, key_opt)) {
        if (this.text && this.esc_clears) {
          this.setText('');
        } else {
          spotUnfocus();
          if (this.input) {
            this.input.blur();
          }
          focused = false;
          this.canceled = true;
        }
      }
    }
    this.is_focused = focused;
    return spot_ret;
  }

  run(params) {
    this.applyParams(params);
    if (this.focus_steal) {
      this.focus_steal = false;
      this.focus();
    }

    let is_reset = false;
    if (!verify(this.last_frame !== engine.frame_index)) {
      // two calls on one frame (asserts in dev, silently do nothing otherwise?)
      return null;
    }
    if (this.last_frame !== engine.frame_index - 1) {
      // it's been more than a frame, we must have not been running, discard async events
      this.submitted = false;
      is_reset = true;
    }
    this.last_frame = engine.frame_index;

    this.canceled = false;
    let { allow_focus, focused } = this.updateFocus(is_reset);

    if (focused) {
      spotSuppressKBNav(true, Boolean(this.multiline || this.suppress_up_down));
    }

    this_frame_edit_boxes.push(this);
    let elem = allow_focus && uiGetDOMElem(this.elem, true);
    if (elem !== this.elem) {
      if (elem) {
        // new DOM element, initialize
        if (!form_hook_registered) {
          form_hook_registered = true;
          let form = document.getElementById('dynform');
          if (form) {
            form.addEventListener('submit', formHook, true);
          }
        }
        elem.textContent = '';
        let input = document.createElement(this.multiline ? 'textarea' : 'input');
        input.setAttribute('type', this.type);
        input.setAttribute('placeholder', getStringIfLocalizable(this.placeholder));
        if (this.max_len) {
          if (this.multiline) {
            input.setAttribute('cols', this.max_len);
          } else {
            input.setAttribute('maxLength', this.max_len);
          }
        }
        if (this.multiline) {
          input.setAttribute('rows', this.multiline);
        }
        input.setAttribute('tabindex', 2);
        elem.appendChild(input);
        let span = document.createElement('span');
        span.setAttribute('tabindex', 3);
        this.postspan = span;
        elem.appendChild(span);
        input.value = this.text;
        if (this.uppercase) {
          input.style['text-transform'] = 'uppercase';
        }
        this.input = input;
        if (this.initial_focus || this.onetime_focus) {
          input.focus();
          setActive(this);
          this.onetime_focus = false;
        }
        if (this.initial_select) {
          input.select();
        }

        if (this.multiline || this.max_len) {
          // Do update _immediately_ so the DOM doesn't draw the invalid text, if possible
          const onChange = (e) => {
            this.updateText();
            return true;
          };
          input.addEventListener('keyup', onChange);
          input.addEventListener('keydown', onChange);
          input.addEventListener('change', onChange);
        }

      } else {
        this.input = null;
      }
      this.last_autocomplete = null;
      this.submitted = false;
      this.elem = elem;
    } else {
      if (this.input) {
        this.updateText();
      }
    }
    if (elem) {
      let pos = camera2d.htmlPos(this.x, this.y);
      if (!this.spellcheck) {
        elem.spellcheck = false;
      }
      elem.style.left = `${pos[0]}%`;
      elem.style.top = `${pos[1]}%`;
      let size = camera2d.htmlSize(this.w, 0);
      elem.style.width = `${size[0]}%`;
      let old_fontsize = elem.style.fontSize || '?px';

      let new_fontsize = `${camera2d.virtualToFontSize(this.font_height).toFixed(8)}px`;
      if (new_fontsize !== old_fontsize) {
        // elem.style.fontSize = new_fontsize;
        // Try slightly better smooth scaling from https://medium.com/autodesk-tlv/smooth-text-scaling-in-javascript-css-a817ae8cc4c9
        const preciseFontSize = camera2d.virtualToFontSize(this.font_height);  // Desired font size
        const roundedSize = Math.floor(preciseFontSize);
        const s = preciseFontSize / roundedSize; // Remaining scale
        elem.style.fontSize = `${roundedSize}px`;
        //const translate = `translate(${pos.x}px, ${pos.y}px)`;
        const scale = `translate(-50%, -50%)
                       scale(${s})
                       translate(50%, 50%)`;
        elem.style.transform = scale;
      }


      if (this.zindex) {
        elem.style['z-index'] = this.zindex;
      }
      if (this.last_autocomplete !== this.autocomplete) {
        this.last_autocomplete = this.autocomplete;
        this.input.setAttribute('autocomplete', this.autocomplete || `auto_off_${Math.random()}`);
      }
    }

    if (focused) {
      if (this.auto_unfocus) {
        if (inputClick({ peek: true })) {
          spotUnfocus();
        }
      }
      // For IFRAMEs with `sandbox` not including `allow-form`, catch Enter ourselves
      if (keyDownEdge(KEYS.ENTER)) {
        this.submitted = true;
      }
      // keyboard input is handled by the INPUT element, but allow mouse events to trickle
      eatAllKeyboardInput();
    }
    // Eat mouse events going to the edit box
    mouseConsumeClicks({ x: this.x, y: this.y, w: this.w, h: this.h });

    if (this.submitted) {
      this.submitted = false;
      return this.SUBMIT;
    }
    if (this.canceled) {
      this.canceled = false;
      return this.CANCEL;
    }
    return null;
  }
  unrun() {
    // remove from DOM or hide
    this.elem = null;
    this.input = null;
  }
}
GlovUIEditBox.prototype.SUBMIT = 'submit';
GlovUIEditBox.prototype.CANCEL = 'cancel';

export function editBoxCreate(params) {
  return new GlovUIEditBox(params);
}

export function editBox(params, current) {
  let edit_box = getUIElemData('edit_box', params, editBoxCreate);
  let result = edit_box.run(params);

  return {
    result,
    text: edit_box.getText(),
    edit_box,
  };
}
