import 'package:tarasense_mobile/core/network/api_client.dart';
import 'package:tarasense_mobile/features/auth/domain/auth_models.dart';

class AuthApi {
  AuthApi(this._client);

  final ApiClient _client;

  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final response = await _client.postJson(
      '/auth/login',
      data: <String, dynamic>{
        'email': email.trim().toLowerCase(),
        'password': password,
      },
    );
    return AuthSession.fromAuthResponse(response);
  }

  Future<AuthSession> register({
    required String name,
    required String email,
    required String password,
    required String role,
    String? organization,
  }) async {
    final response = await _client.postJson(
      '/auth/register',
      data: <String, dynamic>{
        'name': name.trim(),
        'email': email.trim().toLowerCase(),
        'password': password,
        'role': role,
        if (organization != null && organization.trim().isNotEmpty)
          'organization': organization.trim(),
      },
    );
    return AuthSession.fromAuthResponse(response);
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final response = await _client.postJson(
      '/auth/refresh',
      data: <String, dynamic>{'refreshToken': refreshToken},
    );
    return AuthSession.fromAuthResponse(response);
  }

  Future<UserProfile> me(String accessToken) async {
    final response = await _client.getJson(
      '/auth/me',
      bearerToken: accessToken,
    );
    return UserProfile.fromJson(response);
  }

  Future<void> logout({
    required String accessToken,
    String? refreshToken,
  }) async {
    await _client.postJson(
      '/auth/logout',
      bearerToken: accessToken,
      data: refreshToken == null
          ? null
          : <String, dynamic>{'refreshToken': refreshToken},
    );
  }
}
