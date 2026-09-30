const toggleBtn = document.querySelector(".add-expense-toggle");
const form = document.querySelector(".add-expense-form");

toggleBtn.addEventListener("click", () => {
  form.classList.toggle("hidden");
});
