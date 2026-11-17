/**
 * An in-app confirmation, not the browser's confirm() (which blocks the page
 * and the session's ticks): a modal <dialog> with a title, a text and two
 * buttons. Resolves true for ok; cancel or Esc resolve false.
 */
let box = null;

function build() {
  box = document.createElement('dialog');
  box.className = 'help-pop';
  box.innerHTML = `
    <h2 class="pop-title warn"><bw-icon name="warning"></bw-icon><span data-el="title"></span></h2>
    <p data-el="text"></p>
    <div class="row mt-14 end"><button data-el="cancel"></button><button class="primary" data-el="ok"></button></div>`;
  document.body.append(box);
}

export function confirmBox({ title, text, ok, cancel }) {
  if (!box) build();
  if (box.open) box.close(); // the one already open counts as cancelled
  const part = (name) => box.querySelector(`[data-el="${name}"]`);
  part('title').textContent = title;
  part('text').textContent = text;
  part('ok').textContent = ok;
  part('cancel').textContent = cancel;
  return new Promise((resolve) => {
    part('ok').onclick = () => box.close('ok');
    part('cancel').onclick = () => box.close('');
    box.onclose = () => resolve(box.returnValue === 'ok');
    box.returnValue = '';
    box.showModal();
    part('cancel').focus();
  });
}
