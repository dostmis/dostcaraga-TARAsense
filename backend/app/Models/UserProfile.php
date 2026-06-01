<?php

namespace App\Models;

class UserProfile extends PrismaModel
{
    protected $table = 'user_profiles';

    public $incrementing = false;
    protected $keyType = 'string';
    public $timestamps = false;

    protected $fillable = [
        'id', 'userId', 'regionId', 'provinceId', 'cityId',
        'barangayId', 'addressDetails', 'completedAt', 'createdAt', 'updatedAt',
    ];

    protected $casts = [
        'completedAt' => 'datetime',
        'createdAt' => 'datetime',
        'updatedAt' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class, 'userId');
    }

    public function region()
    {
        return $this->belongsTo(PsgcRegion::class, 'regionId');
    }

    public function province()
    {
        return $this->belongsTo(PsgcProvince::class, 'provinceId');
    }

    public function city()
    {
        return $this->belongsTo(PsgcCity::class, 'cityId');
    }

    public function barangay()
    {
        return $this->belongsTo(PsgcBarangay::class, 'barangayId');
    }
}
