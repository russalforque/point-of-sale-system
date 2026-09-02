using Microsoft.EntityFrameworkCore;
using Sellix.Api.Data;
using Sellix.Api.DTOs.Categories;
using Sellix.Api.Exceptions;
using Sellix.Api.Models;

namespace Sellix.Api.Services;

public class CategoryService
{
    private readonly AppDbContext _db;

    public CategoryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<CategoryDto>> ListAsync(bool? isActive)
    {
        var query = _db.Categories.AsNoTracking().AsQueryable();
        if (isActive.HasValue)
            query = query.Where(c => c.IsActive == isActive.Value);

        return await query
            .OrderBy(c => c.Name)
            .Select(c => new CategoryDto
            {
                Id = c.Id,
                Name = c.Name,
                Description = c.Description,
                IsActive = c.IsActive,
                ProductCount = c.Products.Count
            })
            .ToListAsync();
    }

    public async Task<CategoryDto> GetAsync(int id)
    {
        var category = await _db.Categories.AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new CategoryDto
            {
                Id = c.Id,
                Name = c.Name,
                Description = c.Description,
                IsActive = c.IsActive,
                ProductCount = c.Products.Count
            })
            .FirstOrDefaultAsync() ?? throw new NotFoundException("Category not found.");
        return category;
    }

    public async Task<CategoryDto> CreateAsync(UpsertCategoryRequest request)
    {
        var name = request.Name.Trim();
        if (await _db.Categories.AnyAsync(c => c.Name == name))
            throw new ConflictException("A category with this name already exists.");

        var category = new Category
        {
            Name = name,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            IsActive = request.IsActive
        };
        _db.Categories.Add(category);
        await _db.SaveChangesAsync();
        return new CategoryDto { Id = category.Id, Name = category.Name, Description = category.Description, IsActive = category.IsActive };
    }

    public async Task<CategoryDto> UpdateAsync(int id, UpsertCategoryRequest request)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id)
            ?? throw new NotFoundException("Category not found.");

        var name = request.Name.Trim();
        if (await _db.Categories.AnyAsync(c => c.Name == name && c.Id != id))
            throw new ConflictException("A category with this name already exists.");

        category.Name = name;
        category.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        category.IsActive = request.IsActive;
        await _db.SaveChangesAsync();

        var count = await _db.Products.CountAsync(p => p.CategoryId == id);
        return new CategoryDto { Id = category.Id, Name = category.Name, Description = category.Description, IsActive = category.IsActive, ProductCount = count };
    }

    public async Task DeleteAsync(int id)
    {
        var category = await _db.Categories.FirstOrDefaultAsync(c => c.Id == id)
            ?? throw new NotFoundException("Category not found.");

        if (await _db.Products.AnyAsync(p => p.CategoryId == id))
            throw new ConflictException("Cannot delete a category that is used by products.");

        _db.Categories.Remove(category);
        await _db.SaveChangesAsync();
    }
}
