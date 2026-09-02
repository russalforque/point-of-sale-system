using Microsoft.AspNetCore.Identity;
using Sellix.Api.DTOs.Auth;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class AuthService
{
    private readonly UserManager<ApplicationUser> _users;
    private readonly SignInManager<ApplicationUser> _signIn;
    private readonly JwtTokenService _jwt;

    public AuthService(UserManager<ApplicationUser> users, SignInManager<ApplicationUser> signIn, JwtTokenService jwt)
    {
        _users = users;
        _signIn = signIn;
        _jwt = jwt;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request)
    {
        var user = await _users.FindByEmailAsync(request.Email);
        if (user is null)
            throw new UnauthorizedAppException("Invalid email or password.");

        var result = await _signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            if (result.IsLockedOut)
                throw new UnauthorizedAppException("Account is locked. Try again later.");
            throw new UnauthorizedAppException("Invalid email or password.");
        }

        var (token, expires) = _jwt.CreateToken(user);
        return new LoginResponse
        {
            Token = token,
            ExpiresAt = expires,
            User = Map(user)
        };
    }

    public async Task<UserDto> GetMeAsync(string userId)
    {
        var user = await _users.FindByIdAsync(userId) ?? throw new NotFoundException("User not found.");
        return Map(user);
    }

    public async Task ChangePasswordAsync(string userId, ChangePasswordRequest request)
    {
        var user = await _users.FindByIdAsync(userId) ?? throw new NotFoundException("User not found.");
        var result = await _users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!result.Succeeded)
        {
            var first = result.Errors.FirstOrDefault()?.Description ?? "Unable to change password.";
            throw new AppException(first, 400);
        }
    }

    private static UserDto Map(ApplicationUser user) => new()
    {
        Id = user.Id,
        Email = user.Email ?? string.Empty,
        FullName = user.FullName
    };
}
