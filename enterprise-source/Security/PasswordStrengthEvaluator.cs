namespace Enterprise.Auth
{
    public class PasswordStrengthEvaluator
    {
        public bool Validate(string password)
        {
            // Password security upgrade
            return password.Length >= 12 && password.Any(char.IsUpper) && password.Any(char.IsDigit);
        }
    }
}