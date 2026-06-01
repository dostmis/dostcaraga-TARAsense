import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tarasense_mobile/core/network/api_client.dart';
import 'package:tarasense_mobile/features/auth/state/auth_providers.dart';
import 'package:tarasense_mobile/features/MSME/domain/MSME_models.dart';

class MSMEApi {
  MSMEApi(this._client);

  final ApiClient _client;

  Future<MSMEDashboardData> fetchDashboard(
    String accessToken, {
    String? query,
  }) async {
    final response = await _client.getJson(
      '/MSME/dashboard',
      bearerToken: accessToken,
      queryParameters: (query ?? '').trim().isEmpty
          ? null
          : <String, dynamic>{'q': query!.trim()},
    );
    return MSMEDashboardData.fromJson(response);
  }

  Future<StudyBuilderOptionsData> fetchStudyBuilderOptions(
    String accessToken,
  ) async {
    final response = await _client.getJson(
      '/MSME/study-builder-options',
      bearerToken: accessToken,
    );
    return StudyBuilderOptionsData.fromJson(response);
  }

  Future<Map<String, dynamic>> createStudy(
    String accessToken, {
    required Map<String, dynamic> payload,
  }) {
    return _client.postJson(
      '/MSME/studies',
      bearerToken: accessToken,
      data: payload,
    );
  }

  Future<MSMEProfileData> fetchProfile(String accessToken) async {
    final response = await _client.getJson(
      '/profile',
      bearerToken: accessToken,
    );
    return MSMEProfileData.fromJson(response);
  }

  Future<MSMEProfileData> updateProfile(
    String accessToken, {
    required Map<String, dynamic> payload,
  }) async {
    final response = await _client.patchJson(
      '/profile',
      bearerToken: accessToken,
      data: payload,
    );
    return MSMEProfileData.fromJson(response);
  }
}

final MSMEApiProvider = Provider<MSMEApi>((ref) {
  return MSMEApi(ref.watch(apiClientProvider));
});
