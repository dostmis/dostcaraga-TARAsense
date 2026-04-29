import 'package:dio/dio.dart';
import 'package:tarasense_mobile/core/config/app_config.dart';

class ApiClient {
  ApiClient({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              baseUrl: AppConfig.apiBaseUrl,
              connectTimeout: const Duration(seconds: 30),
              receiveTimeout: const Duration(seconds: 30),
              sendTimeout: const Duration(seconds: 30),
              contentType: Headers.jsonContentType,
              responseType: ResponseType.json,
              headers: const <String, String>{'Accept': 'application/json'},
            ),
          ) {
    if (!const bool.fromEnvironment('dart.vm.product')) {
      _dio.interceptors.add(
        LogInterceptor(
          request: true,
          requestBody: true,
          responseBody: true,
          requestHeader: false,
          responseHeader: false,
        ),
      );
    }
  }

  final Dio _dio;

  Future<Map<String, dynamic>> getJson(
    String path, {
    String? bearerToken,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.get<Map<String, dynamic>>(
      path,
      queryParameters: queryParameters,
      options: _optionsForToken(bearerToken),
    );
    return response.data ?? <String, dynamic>{};
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    String? bearerToken,
    Object? data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.post<Map<String, dynamic>>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: _optionsForToken(bearerToken),
    );
    return response.data ?? <String, dynamic>{};
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    String? bearerToken,
    Object? data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.put<Map<String, dynamic>>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: _optionsForToken(bearerToken),
    );
    return response.data ?? <String, dynamic>{};
  }

  Future<Map<String, dynamic>> patchJson(
    String path, {
    String? bearerToken,
    Object? data,
    Map<String, dynamic>? queryParameters,
  }) async {
    final response = await _dio.patch<Map<String, dynamic>>(
      path,
      data: data,
      queryParameters: queryParameters,
      options: _optionsForToken(bearerToken),
    );
    return response.data ?? <String, dynamic>{};
  }

  Options _optionsForToken(String? bearerToken) {
    if (bearerToken == null || bearerToken.isEmpty) {
      return Options();
    }
    return Options(
      headers: <String, String>{'Authorization': 'Bearer $bearerToken'},
    );
  }

  void dispose() {
    _dio.close(force: true);
  }
}
