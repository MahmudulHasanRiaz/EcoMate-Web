import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

describe('SearchController', () => {
  let controller: SearchController;
  let service: jest.Mocked<SearchService>;

  const mockResults = {
    orders: [],
    products: [],
    customers: [],
  };

  beforeEach(async () => {
    const mockService = { search: jest.fn().mockResolvedValue(mockResults) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        {
          provide: SearchService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    service = module.get(SearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return search results for a valid query', async () => {
    const query: SearchQueryDto = { q: 'test', limit: 5 };
    const result = await controller.search(query);
    expect(service.search).toHaveBeenCalledWith('test', 5);
    expect(result).toEqual(mockResults);
  });

  it('should use default limit of 5 when not provided', async () => {
    const query: SearchQueryDto = { q: 'test' };
    await controller.search(query);
    expect(service.search).toHaveBeenCalledWith('test', 5);
  });

  it('should pass custom limit to service', async () => {
    const query: SearchQueryDto = { q: 'test', limit: 10 };
    await controller.search(query);
    expect(service.search).toHaveBeenCalledWith('test', 10);
  });
});
