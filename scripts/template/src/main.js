const output = document.querySelector('[data-count]');
const button = document.querySelector('[data-increment]');

let count = 0;

button.addEventListener('click', () => {
  count += 1;
  output.textContent = String(count);
});
